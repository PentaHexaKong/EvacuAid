import * as React from "react";

import { cx } from "@/utils/cx";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
    return (
        <textarea
            data-slot="textarea"
            className={cx(
                "min-h-24 w-full min-w-0 rounded-2lg border-0 bg-background-tertiary-default px-3 py-2 text-body-regular text-text-primary outline-none! ring-2 ring-inset ring-transparent transition-[background-color,box-shadow,color] duration-[var(--input-transition-ms)] ease placeholder:text-text-secondary-strong hover:ring-border-button-hover focus-visible:ring-border-button-active disabled:cursor-not-allowed disabled:bg-input-disabled-background disabled:text-input-disabled-text disabled:placeholder:text-input-disabled-text disabled:hover:ring-transparent aria-invalid:bg-background-tertiary-error aria-invalid:placeholder:text-text-error-placeholder aria-invalid:hover:ring-transparent aria-invalid:focus-visible:ring-transparent motion-reduce:transition-none",
                className,
            )}
            {...props}
        />
    );
}

export { Textarea };
