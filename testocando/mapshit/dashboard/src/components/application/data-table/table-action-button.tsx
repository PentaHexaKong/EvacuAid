import { Button, type ButtonProps } from "@/components/base/buttons/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/base/tooltip/tooltip"

type TableActionButtonProps = ButtonProps & { "aria-label": string }

export function TableActionButton(props: TableActionButtonProps) {
  return <TooltipProvider>
    <Tooltip>
      <TooltipTrigger><Button {...props} /></TooltipTrigger>
      <TooltipContent>{props["aria-label"]}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
}
