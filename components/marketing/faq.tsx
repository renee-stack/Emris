export function FaqList({
  items,
}: {
  items: { q: string; a: string }[];
}) {
  return (
    <div className="border-t border-rule">
      {items.map((item) => (
        <div key={item.q} className="border-b border-rule py-5">
          <h3 className="text-sm font-semibold">{item.q}</h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {item.a}
          </p>
        </div>
      ))}
    </div>
  );
}
