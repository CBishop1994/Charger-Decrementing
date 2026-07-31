import { cn } from "@/lib/utils";

/**
 * Deterministic faux QR grid for on-screen label mockups.
 * Not a real QR — just a stable visual stand-in that reads as a QR code.
 */
function FakeQr({ seed, className }: { seed: string; className?: string }) {
  const size = 21;
  const cells: boolean[] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  if (h === 0) h = 0x9e3779b9;

  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 0xffffffff;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder =
        (x < 7 && y < 7) ||
        (x >= size - 7 && y < 7) ||
        (x < 7 && y >= size - 7);
      const onFinderBorder =
        inFinder &&
        (x === 0 ||
          x === 6 ||
          x === size - 7 ||
          x === size - 1 ||
          y === 0 ||
          y === 6 ||
          y === size - 7 ||
          y === size - 1 ||
          (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
          (x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4) ||
          (x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3));
      const inFinderInnerEmpty =
        inFinder &&
        !onFinderBorder &&
        !(x >= 2 && x <= 4 && y >= 2 && y <= 4) &&
        !(x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4) &&
        !(x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3);

      if (onFinderBorder) cells.push(true);
      else if (inFinderInnerEmpty) cells.push(false);
      else cells.push(rand() > 0.45);
    }
  }

  return (
    <div
      className={cn(
        "grid shrink-0 gap-px rounded-[2px] bg-white p-[3px] ring-1 ring-black/10",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
        width: 72,
        height: 72,
      }}
      aria-hidden
    >
      {cells.map((on, i) => (
        <span
          key={i}
          className={on ? "bg-black" : "bg-white"}
          style={{ width: "100%", height: "100%" }}
        />
      ))}
    </div>
  );
}

export function LabelPreview({
  lines,
  footer,
  className,
}: {
  lines: string[];
  footer?: string;
  className?: string;
}) {
  const seed = footer || lines[2] || lines[0] || "asset-tag";

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[300px] rounded-md border-2 border-dashed border-foreground/30 bg-white p-4 text-black shadow-sm dark:bg-zinc-100",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1 font-mono text-[11px] leading-tight">
          {lines.map((line, i) => (
            <p
              key={`${line}-${i}`}
              className={cn(
                "truncate",
                i === 0 && "text-sm font-bold tracking-tight",
                i === 2 && "text-base font-bold tracking-wide",
              )}
            >
              {line}
            </p>
          ))}
        </div>
        <div className="flex flex-col items-center gap-1">
          <FakeQr seed={seed} />
          <p className="max-w-[72px] truncate font-mono text-[8px] tracking-wide text-black/60">
            {footer || lines[2] || "QR"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-center text-[9px] font-semibold uppercase tracking-[0.2em] text-black/50">
        Asset tag preview · QR
      </p>
    </div>
  );
}
