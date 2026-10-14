import type { ReactNode } from "react"
import { Dialog, Heading, Modal, ModalOverlay, Text } from "react-aria-components"
import { cx } from "@/utils/cx"

export function MobileNavigation({ open, onOpenChange, instant, children }: { open: boolean; onOpenChange: (open: boolean) => void; instant: boolean; children: ReactNode }) {
  return <ModalOverlay isOpen={open} onOpenChange={onOpenChange} isDismissable className={cx("fixed inset-0 z-50 lg:hidden transition-opacity duration-250 data-[entering]:opacity-0 data-[exiting]:opacity-0 data-[exiting]:duration-200 motion-reduce:transition-none", instant && "transition-none")}>
    {({ isEntering, isExiting }) => <>
      <div aria-hidden data-slot="mobile-navigation-overlay" className={cx("pointer-events-none absolute inset-y-0 left-[272px] right-[-272px] cursor-pointer rounded-[32px] bg-black/10 dark:bg-white/5 transition-[opacity,translate] duration-250 motion-reduce:transition-none", isExiting && "duration-200", (isEntering || isExiting) && "-translate-x-[272px]", instant && "transition-none")} />
      <Modal className={cx("fixed inset-y-0 left-0 w-[272px] origin-center outline-none transition-[opacity,scale] duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] data-[entering]:scale-[0.96] data-[entering]:opacity-0 data-[exiting]:scale-[0.96] data-[exiting]:opacity-0 data-[exiting]:duration-200 motion-reduce:transition-none", instant && "transition-none")}>
        <Dialog className="h-dvh w-[272px] bg-transparent px-[6px] py-3 outline-none">
          <div className="sr-only"><Heading slot="title">EvacuAid</Heading><Text slot="description">Operations workspace navigation</Text></div>
          {children}
        </Dialog>
      </Modal>
    </>}
  </ModalOverlay>
}
