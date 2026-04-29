export function ReadOnlyField({ id, label, value }: { id: string; label: string; value: string | number }) {
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} readOnly type={typeof value === 'number' ? 'number' : 'text'} />
    </div>
  );
}

export function TextField({
  error,
  id,
  label,
  onChange,
  type = 'text',
  value,
}: {
  error?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} type={type} onChange={(event) => onChange(event.target.value)} />
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function NumberField({
  error,
  id,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  error?: string;
  id: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        type="number"
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function CheckboxField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-field">
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function SelectField<TValue extends string>({
  error,
  id,
  label,
  onChange,
  options,
  value,
}: {
  error?: string;
  id: string;
  label: string;
  onChange: (value: TValue) => void;
  options: TValue[];
  value: TValue;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as TValue)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
