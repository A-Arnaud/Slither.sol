import React from 'react';
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface CyberButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
}

export function CyberButton({ 
  children, 
  className, 
  variant = 'primary', 
  isLoading,
  disabled,
  ...props 
}: CyberButtonProps) {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] border border-primary/50",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] border border-secondary/50",
    danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:shadow-[0_0_30px_rgba(239,68,68,0.6)] border border-destructive/50"
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={cn(
        "relative px-8 py-4 font-bold rounded-lg uppercase tracking-wider transition-all duration-300 font-display",
        "clip-path-polygon disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        "hover:-translate-y-1 active:translate-y-0",
        variants[variant],
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-white/10 opacity-0 hover:opacity-100 transition-opacity rounded-lg" />
      <div className="flex items-center justify-center gap-2">
        {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
        {children}
      </div>
    </button>
  );
}
