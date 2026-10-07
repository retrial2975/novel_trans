import { TERM_CATEGORIES } from "@/db/schema";
import { CATEGORY_LABELS } from "@/lib/prompt";

export function CategorySelect(props: { name?: string; defaultValue?: string; form?: string; className?: string }) {
  return (
    <select name={props.name ?? "category"} defaultValue={props.defaultValue} form={props.form} className={props.className ?? "input"}>
      {TERM_CATEGORIES.map((c) => (
        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
      ))}
    </select>
  );
}
