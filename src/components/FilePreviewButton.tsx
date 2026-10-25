import { Eye } from "lucide-react";
import { t } from "@/lib/i18n";
import { openFilePreview, type MessageFilePreview } from "@/lib/file-preview";
import { tableDelimiter } from "@/lib/table-data";

export function filePreviewLabel(path: string, name: string) {
  return t(tableDelimiter(name) || tableDelimiter(path) ? "table.preview" : /\.html?$/i.test(name) ? "html.preview" : "filePreview.open", { name });
}

export function FilePreviewButton(props: MessageFilePreview) {
  return <button type="button" className="table-action" title={filePreviewLabel(props.path, props.name)} aria-label={filePreviewLabel(props.path, props.name)} onClick={() => openFilePreview(props)}><Eye size={14} /></button>;
}
