import { useState } from 'react';
import { readStorageErrors } from '../storage/errorLog';

/** Recent storage failures on this device, so an intermittent error can be reported exactly. */
export function StorageErrorDetails() {
  const [copied, setCopied] = useState(false);
  const lines = readStorageErrors().map(
    (e) =>
      `${e.at} · ${e.phase} · ${e.name}: ${e.message} (${e.visibility}${e.standalone ? ', 설치 앱' : ''})`,
  );
  if (!lines.length) return null;
  const text = [navigator.userAgent, ...lines].join('\n');
  return (
    <details className="error-log">
      <summary>오류 정보</summary>
      <pre>{lines.join('\n')}</pre>
      <button
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? '복사됨' : '오류 정보 복사'}
      </button>
    </details>
  );
}
