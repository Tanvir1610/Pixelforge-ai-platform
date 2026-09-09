/** Route-level skeleton so navigation never lands on a blank screen. */
export default function Loading() {
  return (
    <div className="p-8">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-[104px] rounded-lg" />
        ))}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="skeleton h-[260px] rounded-lg" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
