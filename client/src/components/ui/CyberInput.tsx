import React from 'react';
import { cn } from "@/lib/utils";

interface CyberInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function CyberInput({ className, label, ...props }: CyberInputProps) {
  return (
    <div className="space-y-2 w-full">
      {label && (
        <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">
          {label}
        </label>
      )}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-secondary rounded-lg blur opacity-30 group-hover:opacity-75 transition duration-500" />
        <input
          className={cn(
            "relative w-full bg-black/80 border border-white/10 text-white px-4 py-3 rounded-lg",
            "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent",
            "placeholder:text-white/30 font-mono transition-all",
            className
          )}
          {...props}
        />
      </div>
    </div>
  );
}
