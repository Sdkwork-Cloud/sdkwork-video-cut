const SENSITIVE_FIELD_NAME_PATTERN =
  /(?:^|[_-])(?:api[_-]?key|authorization|server[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|credential[_-]?secret(?:[_-]?ref)?|x[_-]?api[_-]?key)(?:$|[_-])/i;

const SAFE_STATUS_FIELD_NAMES = new Set([
  'apiKeyConfigured',
  'artifactContentAuthorizationVerified',
  'artifactDownloadAuthorizationVerified',
  'credentialStatus',
]);

export function reportContainsSensitiveData(value, knownSensitiveValues = []) {
  return containsSensitiveData(value, normalizeKnownSensitiveValues(knownSensitiveValues));
}

export function sanitizeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic|ApiKey|Token)\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: <redacted>')
    .replace(/\b(X-Api-Key|Api-Key)\s*:\s*[^,\s&]+/gi, '$1: <redacted>')
    .replace(/\b(Bearer|Basic|ApiKey|Token)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <redacted>')
    .replace(/([?&](?:api_key|apikey|access_token|refresh_token|auth_token|server_token|token|secret|password)=)[^&\s'",)]+/gi, '$1<redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '<redacted-secret>')
    .replace(/(^|[^A-Za-z0-9+.-])([A-Za-z]:[\\/][^\s'",)]+)/g, '$1<redacted-path>')
    .replace(/\\\\[^\\\s'",)]+\\[^\\\s'",)]+(?:\\[^\s'",)]+)*/g, '<redacted-path>')
    .replace(/\/(?:Users|home|var|tmp|private|mnt|opt|workspace|data|Volumes)\/[^\s'",)]+/g, '<redacted-path>');
}

export function redactReport(report, knownSensitiveValues = []) {
  const knownSecrets = normalizeKnownSensitiveValues(knownSensitiveValues);
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (isSensitiveFieldName(key)) {
        return undefined;
      }

      if (typeof value === 'string' && shouldRedactLocalPath(key, value)) {
        return '<redacted-path>';
      }

      if (typeof value === 'string') {
        return redactKnownSensitiveValues(value, knownSecrets);
      }

      return value;
    }),
  );
}

export function findLocalAbsolutePath(value, path = '$') {
  if (value instanceof Error) {
    return isLocalAbsolutePath(value.message) ? path : '';
  }

  if (typeof value === 'string') {
    return isLocalAbsolutePath(value) ? path : '';
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = findLocalAbsolutePath(value[index], `${path}[${index}]`);
      if (childPath) {
        return childPath;
      }
    }
    return '';
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = findLocalAbsolutePath(child, `${path}.${key}`);
      if (childPath) {
        return childPath;
      }
    }
  }

  return '';
}

export function isLocalAbsolutePath(value) {
  const normalized = String(value || '').trim();
  if (!normalized || isSafeExternalOrVirtualUri(normalized)) {
    return false;
  }

  return Boolean(
    /(^|[^A-Za-z0-9+.-])[A-Za-z]:[\\/]/.test(normalized) ||
      /\\\\[^\\]+\\[^\\]+/.test(normalized) ||
      /(^|[^A-Za-z0-9._-])\/(?:Users|home|var|tmp|private|mnt|opt|workspace|data|Volumes)(?:[\\/]|$|[\s'",).;:])/.test(
        normalized,
      ),
  );
}

function isSafeExternalOrVirtualUri(value) {
  return /^(?:https?|assets):\/\//i.test(value);
}

function containsSensitiveData(value, knownSensitiveValues = []) {
  if (value instanceof Error) {
    return stringContainsSensitiveData(value.message, knownSensitiveValues);
  }

  if (typeof value === 'string') {
    return stringContainsSensitiveData(value, knownSensitiveValues);
  }

  if (Array.isArray(value)) {
    return value.some((child) => containsSensitiveData(child, knownSensitiveValues));
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveFieldName(key) && hasSensitiveFieldValue(child)) {
        return true;
      }
      if (containsSensitiveData(child, knownSensitiveValues)) {
        return true;
      }
    }
  }

  return false;
}

function normalizeKnownSensitiveValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function redactKnownSensitiveValues(value, knownSensitiveValues = []) {
  return knownSensitiveValues.reduce(
    (redacted, secret) => redacted.split(secret).join('<redacted-secret>'),
    value,
  );
}

function hasSensitiveFieldValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'boolean') {
    return false;
  }

  if (typeof value === 'number') {
    return false;
  }

  const normalized = typeof value === 'string' ? value.trim() : JSON.stringify(value);
  return Boolean(normalized && normalized !== 'configured' && normalized !== 'not-configured');
}

function isSensitiveFieldName(key) {
  if (SAFE_STATUS_FIELD_NAMES.has(key)) {
    return false;
  }

  return SENSITIVE_FIELD_NAME_PATTERN.test(String(key || ''));
}

function stringContainsSensitiveData(value, knownSensitiveValues = []) {
  const serialized = String(value || '');
  return Boolean(
    knownSensitiveValues.some((secret) => serialized.includes(secret)) ||
    /\bAuthorization\s*:\s*(?:Bearer|Basic|ApiKey|Token)\s+[A-Za-z0-9._~+/=-]+/i.test(serialized) ||
      /\b(?:X-Api-Key|Api-Key)\s*:\s*[^,\s&]+/i.test(serialized) ||
      /\b(?:Bearer|Basic|ApiKey)\s+(?=[A-Za-z0-9._~+/=-]{8,}\b)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+/i.test(
        serialized,
      ) ||
      /\bToken\s+(?=[A-Za-z0-9._~+/=-]{12,}\b)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+/i.test(
        serialized,
      ) ||
      /[?&](?:api_key|apikey|access_token|refresh_token|auth_token|server_token|token|secret|password)=[^&\s'",)]+/i.test(
        serialized,
      ) ||
      /\bsk-[A-Za-z0-9_-]{8,}/.test(serialized),
  );
}

function shouldRedactLocalPath(key, value) {
  const normalizedKey = String(key || '').toLowerCase();
  const isPathField =
    normalizedKey === 'path' ||
    normalizedKey.endsWith('path') ||
    normalizedKey.endsWith('root') ||
    normalizedKey.includes('workspace') ||
    normalizedKey.includes('artifact') ||
    normalizedKey.includes('temp') ||
    normalizedKey.includes('file');

  return isPathField && isLocalAbsolutePath(value);
}
