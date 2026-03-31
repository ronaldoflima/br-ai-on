"use client";

export function Skeleton({ width, height, count = 1 }: { width?: string; height?: string; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width: width || "100%", height: height || "60px" }}
        />
      ))}
    </>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card skeleton" style={{ height: "120px" }} />
      ))}
    </div>
  );
}
