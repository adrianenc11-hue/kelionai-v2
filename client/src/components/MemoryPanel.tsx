import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";
import { Trash2, Brain, X } from "lucide-react";
import { toast } from "sonner";

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MemoryPanel({ isOpen, onClose }: MemoryPanelProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: memories = [] as Array<{ id: number; key: string; value: string }>, isLoading } = trpc.memory.getMemories.useQuery();
  const deleteMutation = trpc.memory.deleteMemory.useMutation({
    onSuccess: () => utils.memory.getMemories.invalidate(),
  });
  const clearMutation = trpc.memory.clearAll.useMutation({
    onSuccess: () => { utils.memory.getMemories.invalidate(); toast.success("Memories cleared"); },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-slate-900 border-l border-slate-700 z-40 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <span className="font-semibold text-white">{t("memory.title")}</span>
          <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">{memories.length}</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      <p className="text-xs text-slate-400 px-4 pt-3 pb-1">{t("memory.subtitle")}</p>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="text-slate-400 text-sm text-center py-8">Loading...</div>
        ) : memories.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-8">{t("memory.empty")}</div>
        ) : (
          memories.map((mem) => (
            <div key={mem.id} className="bg-slate-800 rounded-lg p-3 flex items-start gap-2 group">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-purple-400 font-medium truncate">{mem.key}</p>
                <p className="text-sm text-white mt-0.5 break-words">{mem.value}</p>
              </div>
              <button
                onClick={() => deleteMutation.mutate({ memoryId: mem.id })}
                className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {memories.length > 0 && (
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={() => clearMutation.mutate()}
            className="w-full text-sm text-red-400 hover:text-red-300 py-2 rounded border border-red-400/20 hover:border-red-400/40 transition-colors"
          >
            {t("memory.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
