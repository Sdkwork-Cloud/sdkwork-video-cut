import React from "react";

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  children?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const baseStyle =
    "inline-flex items-center justify-center rounded-lg font-bold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50";

  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20",
    secondary: "bg-[#222] text-gray-200 hover:bg-[#333] border border-[#333]",
    outline: "border border-[#333] bg-transparent hover:bg-[#252525] text-gray-200",
    ghost: "hover:bg-[#252525] text-gray-300",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs tracking-wide",
    md: "h-10 px-4 text-sm tracking-wide",
    lg: "h-12 px-6 text-base tracking-wide font-semibold",
  };

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
