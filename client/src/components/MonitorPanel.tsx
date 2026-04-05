import { useTranslation } from "react-i18next";
import { Monitor, Search, Cloud, Code2, Eye, Calculator, Languages } from "lucide-react";

export type MonitorItem = {
  id: string;
  type: "search" | "weather" | "code" | "vision" | "math" | "translation" | "thinking";
  title: string;
  content: string;
  timestamp: Date;
};

interface MonitorPanelProps {
  items: MonitorItem[];
  isVisible: boolean;
  activeThinking?: string | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  search: <Search className="w-4 h-4 text-blue-400" />,
  weather: <Cloud className="w-4 h-4 text-cyan-400" />,
  code: <Code2 className="w-4 h-4 text-green-400" />,
  vision: <Eye className="w-4 h-4 text-purple-400" />,
  math: <Calculator className="w-4 h-4 text-yellow-400" />,
  translation: <Languages className="w-4 h-4 text-pink-400" />,
  thinking: <Monitor className="w-4 h-4 text-orange-400" />,
};

export default function MonitorPanel({ items, isVisible, activeThinking }: MonitorPanelProps) {
  const { t } = useTranslation();
  if (!isVisible) return null;

  return (
    <div className="h-full flex flex-col bg-slate-950 border-l border-slate-800">
      <div className="flex items-center gap-2 p-4 border-b border-slate-800">
        <Monitor className="w-5 h-5 text-blue-400" />
        <span className="font-semibold text-white text-sm">{t("monitor.title")}</span>
        {activeThinking && (
          <span className="ml-auto text-xs text-orange-400 animate-pulse flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-ping inline-block" />
            {activeThinking}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-12">{t("monitor.empty")}</div>
        ) : (
          [...items].reverse().map((item) => (
            <div key={item.id} className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border-b border-slate-700">
                {typeIcons[item.type]}
                <span className="text-xs font-medium text-slate-300">{item.title}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {item.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className="p-3">
                {item.type === "code" ? (
                  <pre className="text-xs text-green-300 overflow-x-auto whitespace-pre-wrap font-mono">{item.content}</pre>
                ) : (
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{item.content}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
