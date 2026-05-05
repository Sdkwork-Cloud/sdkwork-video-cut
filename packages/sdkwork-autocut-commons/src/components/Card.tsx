import React from "react";

export function Card({
  className = "",
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={`bg-[#111] border border-[#222] rounded-2xl text-gray-200 shadow-[0_4px_24px_rgba(0,0,0,0.6)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
