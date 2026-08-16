"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useNavStore, type NavItem } from "@/components/modules/navbar"
import { ROUTES } from "@/route/config"
import { usePreload } from "@/route/use-preload"
import { ENTRANCE_VARIANTS } from "@/lib/animations/fluid-transitions"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/animate-ui/components/animate/tooltip"
import { useTranslations } from "next-intl"

export function NavBar() {
    const { activeItem, setActiveItem } = useNavStore()
    const { preload } = usePreload()
    const t = useTranslations('navbar')

    return (
        <div className="relative z-50 md:min-h-screen">
            <motion.nav
                aria-label={t('label')}
                className={cn(
                    "fixed left-1/2 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 touch-pan-x scroll-px-2 items-center gap-1 overflow-x-auto overscroll-x-contain p-2.5",
                    "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
                    "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    "md:sticky md:top-30 md:left-auto md:bottom-auto md:w-auto md:max-w-none md:translate-x-0 md:flex-col md:gap-3 md:overflow-visible md:p-3",
                    "bg-sidebar text-sidebar-foreground border border-sidebar-border rounded-3xl",
                    "custom-shadow"
                )}
                variants={ENTRANCE_VARIANTS.navbar}
                initial="initial"
                animate="animate"
            >
                {ROUTES.map((route, index) => {
                    const isActive = activeItem === route.id
                    const label = t(route.id)
                    return (
                        <Tooltip key={route.id} side="top" sideOffset={10} align="center">
                            <TooltipTrigger asChild>
                                <motion.button
                                    type="button"
                                    aria-label={label}
                                    aria-current={isActive ? 'page' : undefined}
                                    onClick={() => setActiveItem(route.id as NavItem)}
                                    onMouseEnter={() => preload(route.id)}
                                    className={cn(
                                        "relative z-20 flex size-10 min-h-10 min-w-10 items-center justify-center rounded-2xl",
                                        "outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
                                        "md:size-12 md:min-h-12 md:min-w-12",
                                        isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent"
                                    )}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{
                                        opacity: 1,
                                        scale: 1,
                                        transition: {
                                            delay: index * 0.05,
                                            duration: 0.3,
                                        }
                                    }}
                                    whileHover={{ scale: 1.1, zIndex: 30 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    {isActive && (
                                        <motion.div
                                            layoutId="navbar-indicator"
                                            className="absolute inset-0 bg-sidebar-primary rounded-2xl z-0"
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10">
                                        <route.icon strokeWidth={2} />
                                    </span>
                                </motion.button>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    )
                })}
            </motion.nav>
        </div>
    )
}
