use std::path::Path;

use ort::{inputs, session::Session, value::Tensor};
use serde_json::{Value, json};

pub(crate) const VAD_RANGES_SCHEMA_ID: &str = "video-cut.vad-ranges.schema.v1";
const VAD_SAMPLE_RATE: u32 = 16_000;
const VAD_FRAME_SAMPLES: usize = 512;
const VAD_THRESHOLD: f32 = 0.5;
const VAD_MIN_SPEECH_DURATION_MS: u64 = 250;
const VAD_MIN_SILENCE_DURATION_MS: u64 = 100;

#[derive(Clone, Debug)]
pub(crate) struct VadDetectionConfig {
    pub(crate) sample_rate: u32,
    pub(crate) threshold: f32,
    pub(crate) min_speech_duration_ms: u64,
    pub(crate) min_silence_duration_ms: u64,
}

impl Default for VadDetectionConfig {
    fn default() -> Self {
        Self {
            sample_rate: VAD_SAMPLE_RATE,
            threshold: VAD_THRESHOLD,
            min_speech_duration_ms: VAD_MIN_SPEECH_DURATION_MS,
            min_silence_duration_ms: VAD_MIN_SILENCE_DURATION_MS,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct VadFrameProbability {
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
    pub(crate) probability: f32,
}

pub(crate) trait VadModelPort {
    fn detect_probabilities(
        &mut self,
        samples: &[f32],
        config: &VadDetectionConfig,
    ) -> Result<Vec<VadFrameProbability>, String>;
}

pub(crate) fn detect_speech_activity_document(
    settings: &Value,
    audio_file_path: &Path,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    audio_available: bool,
) -> Value {
    if !audio_available || !audio_file_path.is_file() {
        return vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "audio-unavailable",
            vec![format!(
                "Audio file is not available at {}.",
                audio_file_path.display()
            )],
            vec![],
        );
    }

    let onnx_runtime_enabled = settings
        .pointer("/mediaTools/onnxRuntimeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !onnx_runtime_enabled {
        return vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "unavailable",
            vec!["ONNX Runtime is disabled in mediaTools.onnxRuntimeEnabled.".to_string()],
            vec![],
        );
    }

    let model_path = settings
        .pointer("/mediaTools/sileroVadModelPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if model_path.trim().is_empty() || !Path::new(model_path).is_file() {
        return vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "unavailable",
            vec![format!(
                "Silero VAD ONNX model is not available at {}.",
                if model_path.trim().is_empty() {
                    "<empty>"
                } else {
                    model_path
                }
            )],
            vec![],
        );
    }

    match OrtSileroVadModel::new(Path::new(model_path)) {
        Ok(mut model) => detect_speech_activity_document_with_model(
            audio_file_path,
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            audio_available,
            &mut model,
        ),
        Err(error) => vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "failed",
            vec![format!(
                "Silero VAD ONNX model initialization failed: {error}"
            )],
            vec![],
        ),
    }
}

pub(crate) fn detect_speech_activity_document_with_model(
    audio_file_path: &Path,
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    audio_available: bool,
    model: &mut dyn VadModelPort,
) -> Value {
    if !audio_available || !audio_file_path.is_file() {
        return vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "audio-unavailable",
            vec![format!(
                "Audio file is not available at {}.",
                audio_file_path.display()
            )],
            vec![],
        );
    }

    let config = VadDetectionConfig::default();
    let samples = match read_mono_pcm16_wav_samples(audio_file_path, config.sample_rate) {
        Ok(samples) => samples,
        Err(error) => {
            return vad_status_document(
                task_id,
                audio_artifact_id,
                audio_artifact_path,
                "failed",
                vec![format!("VAD audio decode failed: {error}")],
                vec![],
            );
        }
    };

    match model.detect_probabilities(&samples, &config) {
        Ok(probabilities) => vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "ok",
            vec![],
            probabilities_to_vad_ranges(&probabilities, &config),
        ),
        Err(error) => vad_status_document(
            task_id,
            audio_artifact_id,
            audio_artifact_path,
            "failed",
            vec![format!("Silero VAD ONNX inference failed: {error}")],
            vec![],
        ),
    }
}

pub(crate) fn probabilities_to_vad_ranges(
    probabilities: &[VadFrameProbability],
    config: &VadDetectionConfig,
) -> Vec<Value> {
    let mut ranges = Vec::new();
    let mut active_start_ms = None;
    let mut last_speech_end_ms = 0;
    let mut confidence_sum = 0.0f32;
    let mut confidence_count = 0u32;

    for frame in probabilities {
        let is_speech = frame.probability >= config.threshold;
        if is_speech {
            if active_start_ms.is_none() {
                active_start_ms = Some(frame.start_ms);
                confidence_sum = 0.0;
                confidence_count = 0;
            }
            last_speech_end_ms = frame.end_ms;
            confidence_sum += frame.probability;
            confidence_count += 1;
            continue;
        }

        let Some(start_ms) = active_start_ms else {
            continue;
        };
        if frame.end_ms.saturating_sub(last_speech_end_ms) >= config.min_silence_duration_ms {
            push_vad_range(
                &mut ranges,
                start_ms,
                last_speech_end_ms,
                confidence_sum,
                confidence_count,
                config,
            );
            active_start_ms = None;
            confidence_sum = 0.0;
            confidence_count = 0;
        }
    }

    if let Some(start_ms) = active_start_ms {
        push_vad_range(
            &mut ranges,
            start_ms,
            last_speech_end_ms,
            confidence_sum,
            confidence_count,
            config,
        );
    }

    ranges
}

fn push_vad_range(
    ranges: &mut Vec<Value>,
    start_ms: u64,
    end_ms: u64,
    confidence_sum: f32,
    confidence_count: u32,
    config: &VadDetectionConfig,
) {
    if end_ms <= start_ms || end_ms - start_ms < config.min_speech_duration_ms {
        return;
    }

    let confidence = if confidence_count == 0 {
        0.0
    } else {
        round_to_two_decimals(confidence_sum / confidence_count as f32)
    };
    ranges.push(json!({
        "startMs": start_ms,
        "endMs": end_ms,
        "confidence": confidence
    }));
}

fn round_to_two_decimals(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

fn read_mono_pcm16_wav_samples(path: &Path, expected_sample_rate: u32) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|error| error.to_string())?;
    let spec = reader.spec();
    if spec.sample_rate != expected_sample_rate {
        return Err(format!(
            "Expected {expected_sample_rate}Hz audio for VAD, got {}Hz.",
            spec.sample_rate
        ));
    }
    if spec.channels != 1 {
        return Err(format!(
            "Expected mono audio for VAD, got {} channels.",
            spec.channels
        ));
    }

    match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 1..=16) => reader
            .samples::<i16>()
            .map(|sample| {
                sample
                    .map(|value| value as f32 / i16::MAX as f32)
                    .map_err(|error| error.to_string())
            })
            .collect(),
        (hound::SampleFormat::Int, 17..=32) => {
            let max_amplitude = (1_i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|sample| {
                    sample
                        .map(|value| value as f32 / max_amplitude)
                        .map_err(|error| error.to_string())
                })
                .collect()
        }
        (hound::SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .map(|sample| sample.map_err(|error| error.to_string()))
            .collect(),
        _ => Err(format!(
            "Unsupported VAD WAV format: {:?} {} bits.",
            spec.sample_format, spec.bits_per_sample
        )),
    }
}

struct OrtSileroVadModel {
    session: Session,
    state: Vec<f32>,
}

impl OrtSileroVadModel {
    fn new(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|error| error.to_string())?
            .with_intra_threads(1)
            .map_err(|error| error.to_string())?
            .commit_from_file(model_path)
            .map_err(|error| error.to_string())?;

        Ok(Self {
            session,
            state: vec![0.0; 2 * 128],
        })
    }

    fn run_frame(&mut self, frame: &[f32], sample_rate: u32) -> Result<f32, String> {
        let input = Tensor::from_array(([1usize, frame.len()], frame.to_vec()))
            .map_err(|error| error.to_string())?;
        let state = Tensor::from_array(([2usize, 1, 128], self.state.clone()))
            .map_err(|error| error.to_string())?;
        let sr = Tensor::from_array(((), vec![sample_rate as i64]))
            .map_err(|error| error.to_string())?;
        let input_names: Vec<String> = self
            .session
            .inputs()
            .iter()
            .map(|input| input.name().to_string())
            .collect();

        let outputs = if input_names.iter().any(|name| name == "state")
            && input_names.iter().any(|name| name == "sr")
        {
            self.session
                .run(inputs! {
                    "input" => input,
                    "state" => state,
                    "sr" => sr,
                })
                .map_err(|error| error.to_string())?
        } else {
            self.session
                .run(inputs![input])
                .map_err(|error| error.to_string())?
        };

        let probability = outputs
            .get("output")
            .unwrap_or(&outputs[0])
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1
            .first()
            .copied()
            .ok_or_else(|| "Silero VAD output tensor is empty.".to_string())?;

        if let Some(next_state) = outputs.get("stateN").or_else(|| outputs.get("state")) {
            let (_, state_values) = next_state
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            self.state = state_values.to_vec();
        } else if outputs.len() > 1 {
            let (_, state_values) = outputs[1]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?;
            self.state = state_values.to_vec();
        }

        Ok(probability)
    }
}

impl VadModelPort for OrtSileroVadModel {
    fn detect_probabilities(
        &mut self,
        samples: &[f32],
        config: &VadDetectionConfig,
    ) -> Result<Vec<VadFrameProbability>, String> {
        let mut probabilities = Vec::new();
        for (frame_index, chunk) in samples.chunks(VAD_FRAME_SAMPLES).enumerate() {
            let mut frame = vec![0.0; VAD_FRAME_SAMPLES];
            frame[..chunk.len()].copy_from_slice(chunk);
            let probability = self.run_frame(&frame, config.sample_rate)?;
            let start_ms = samples_to_ms(frame_index * VAD_FRAME_SAMPLES, config.sample_rate);
            let end_ms = samples_to_ms(
                (frame_index * VAD_FRAME_SAMPLES + chunk.len()).min(samples.len()),
                config.sample_rate,
            )
            .max(start_ms + 1);
            probabilities.push(VadFrameProbability {
                start_ms,
                end_ms,
                probability,
            });
        }

        Ok(probabilities)
    }
}

fn samples_to_ms(samples: usize, sample_rate: u32) -> u64 {
    ((samples as f64 / sample_rate as f64) * 1000.0).round() as u64
}

fn vad_status_document(
    task_id: &str,
    audio_artifact_id: &str,
    audio_artifact_path: &str,
    vad_status: &str,
    warnings: Vec<String>,
    ranges: Vec<Value>,
) -> Value {
    json!({
        "schemaId": VAD_RANGES_SCHEMA_ID,
        "vadRangesVersion": 1,
        "taskId": task_id,
        "audioArtifactId": audio_artifact_id,
        "audioPath": audio_artifact_path,
        "providerId": "silero-vad-onnx",
        "adapterVersion": "silero-vad-onnx.adapter.v1",
        "vadStatus": vad_status,
        "parameters": {
            "sampleRate": VAD_SAMPLE_RATE,
            "threshold": VAD_THRESHOLD,
            "minSpeechDurationMs": VAD_MIN_SPEECH_DURATION_MS,
            "minSilenceDurationMs": VAD_MIN_SILENCE_DURATION_MS
        },
        "ranges": ranges,
        "warnings": warnings,
        "createdAt": crate::contracts::fixed_time()
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::{
        VadDetectionConfig, VadFrameProbability, VadModelPort, detect_speech_activity_document,
        detect_speech_activity_document_with_model, probabilities_to_vad_ranges,
    };

    #[test]
    fn reports_audio_unavailable_without_faking_speech_ranges() {
        let document = detect_speech_activity_document(
            &json!({ "mediaTools": { "onnxRuntimeEnabled": true } }),
            Path::new("missing.wav"),
            "task-001",
            "task-001-audio-source",
            "workspace/projects/default/tasks/task-001/audio/source.wav",
            false,
        );

        assert_eq!(document["schemaId"], "video-cut.vad-ranges.schema.v1");
        assert_eq!(document["vadStatus"], "audio-unavailable");
        assert_eq!(document["ranges"].as_array().expect("ranges").len(), 0);
        assert!(
            !document["warnings"]
                .as_array()
                .expect("warnings")
                .is_empty()
        );
    }

    #[test]
    fn groups_model_probabilities_into_standard_speech_ranges() {
        let ranges = probabilities_to_vad_ranges(
            &[
                VadFrameProbability {
                    start_ms: 0,
                    end_ms: 32,
                    probability: 0.10,
                },
                VadFrameProbability {
                    start_ms: 32,
                    end_ms: 64,
                    probability: 0.80,
                },
                VadFrameProbability {
                    start_ms: 64,
                    end_ms: 96,
                    probability: 0.70,
                },
                VadFrameProbability {
                    start_ms: 96,
                    end_ms: 128,
                    probability: 0.20,
                },
                VadFrameProbability {
                    start_ms: 128,
                    end_ms: 160,
                    probability: 0.15,
                },
            ],
            &VadDetectionConfig {
                sample_rate: 16_000,
                threshold: 0.50,
                min_speech_duration_ms: 64,
                min_silence_duration_ms: 64,
            },
        );

        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0]["startMs"], 32);
        assert_eq!(ranges[0]["endMs"], 96);
        assert_eq!(ranges[0]["confidence"], 0.75);
    }

    #[test]
    fn configured_vad_model_port_reads_wav_and_writes_ok_document() {
        let audio_path = unique_temp_path("vad-ok.wav");
        write_test_wav(&audio_path, &[0, 1000, -1000, 500, -500, 250, -250, 0]);

        let mut model = FakeVadModel {
            received_samples: 0,
            probabilities: (0..8)
                .map(|index| VadFrameProbability {
                    start_ms: index * 32,
                    end_ms: (index + 1) * 32,
                    probability: 0.90,
                })
                .collect(),
        };

        let document = detect_speech_activity_document_with_model(
            &audio_path,
            "task-001",
            "task-001-audio-source",
            "workspace/projects/default/tasks/task-001/audio/source.wav",
            true,
            &mut model,
        );

        assert_eq!(model.received_samples, 8);
        assert_eq!(document["vadStatus"], "ok");
        assert_eq!(document["warnings"].as_array().expect("warnings").len(), 0);
        assert_eq!(document["ranges"].as_array().expect("ranges").len(), 1);

        let _ = fs::remove_file(audio_path);
    }

    struct FakeVadModel {
        received_samples: usize,
        probabilities: Vec<VadFrameProbability>,
    }

    impl VadModelPort for FakeVadModel {
        fn detect_probabilities(
            &mut self,
            samples: &[f32],
            _config: &VadDetectionConfig,
        ) -> Result<Vec<VadFrameProbability>, String> {
            self.received_samples = samples.len();
            Ok(self.probabilities.clone())
        }
    }

    fn unique_temp_path(file_name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("sdkwork-video-cut-{nanos}-{file_name}"))
    }

    fn write_test_wav(path: &Path, samples: &[i16]) {
        let mut bytes = Vec::new();
        let data_len = (samples.len() * 2) as u32;
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.extend_from_slice(&32_000_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        fs::write(path, bytes).expect("write wav");
    }
}
