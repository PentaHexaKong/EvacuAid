import { cn } from "@/lib/utils";

const BAR_COUNT = 12;

const BAR_WIDTH = 16 * 0.24;
const BAR_HEIGHT = 16 * 0.08;
const BAR_X = 8 + 16 * -0.1;
const BAR_Y = 8 + 16 * -0.039;

function Spinner({
    className,
    size,
    stroke,
    ...props
}: React.ComponentProps<"svg"> & {
    size?: number | string;
    stroke?: number | string;
}) {
    const dimension = size == null ? undefined : Number(size);

    return (
        <svg
            role="status"
            aria-label="Loading"
            viewBox="0 0 16 16"
            fill="currentColor"
            overflow="visible"
            width={dimension}
            height={dimension}
            stroke={typeof stroke === "number" ? String(stroke) : stroke}
            className={cn("size-4 shrink-0", className)}
            {...props}
        >
            {Array.from({ length: BAR_COUNT }, (_, i) => (
                <rect
                    key={i}
                    x={BAR_X}
                    y={BAR_Y}
                    width={BAR_WIDTH}
                    height={BAR_HEIGHT}
                    rx={BAR_HEIGHT / 2}
                    className="origin-center animate-spinner-bars motion-reduce:animate-none [transform-box:fill-box]"
                    style={{
                        animationDelay: `${String(-1.2 + i * 0.1)}s`,
                        transform: `rotate(${String(i === 0 ? 0.0001 : i * 30)}deg) translate(146%)`,
                    }}
                />
            ))}
        </svg>
    );
}

Spinner.displayName = "Spinner";

export { Spinner };
