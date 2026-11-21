import type { SeatOption } from '../model/buyIn';

// 앉을 자리를 고르는 선택칸
export function SeatField({
  options,
  seat,
  busy,
  onChange,
}: {
  options: SeatOption[];
  seat: SeatOption | undefined;
  busy: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <div className="fields">
      <label>
        자리
        <select value={seat?.key ?? ''} disabled={busy} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
