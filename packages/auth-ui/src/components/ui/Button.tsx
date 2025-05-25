import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const baseClasses = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    
    const variantClasses = {
      default: "bg-black text-white shadow hover:bg-gray-800 active:bg-gray-900 dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:active:bg-gray-200",
      destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800",
      outline: "border border-gray-300 bg-white shadow-sm hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:active:bg-gray-600",
      secondary: "bg-gray-100 text-gray-900 shadow-sm hover:bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:active:bg-gray-500",
      ghost: "hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200 dark:hover:bg-gray-800 dark:hover:text-gray-100 dark:active:bg-gray-700",
      link: "text-gray-900 underline-offset-4 hover:underline dark:text-gray-100"
    }
    
    const sizeClasses = {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-10 rounded-md px-8",
      icon: "h-9 w-9"
    }

    const classes = cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      className
    )

    if (asChild) {
      // For asChild functionality, you'd need to implement Slot from Radix
      // For now, we'll just render as a button
      console.warn("asChild prop is not supported in this custom Button implementation")
    }

    return (
      <button
        className={classes}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
