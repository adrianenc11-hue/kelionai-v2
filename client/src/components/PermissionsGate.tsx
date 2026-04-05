import { useState, useEffect, ReactNode } from "react";
import { Mic, Camera, MapPin, AlertCircle } from "lucide-react";

interface PermissionsGateProps {
  children: ReactNode;
}

type PermState = "checking" | "granted" | "denied" | "requesting";

export default function PermissionsGate({ children }: PermissionsGateProps) {
  const [state, setState] = useState<PermState>("checking");
  const [deniedList, setDeniedList] = useState<string[]>([]);

  const checkAll = async (): Promise<boolean> => {
    const denied: string[] = [];
    try {
      const [mic, cam, geo] = await Promise.all([
        navigator.permissions.query({ name: "microphone" as PermissionName }),
        navigator.permissions.query({ name: "camera" as PermissionName }),
        navigator.permissions.query({ name: "geolocation" as PermissionName }),
      ]);
      if (mic.state === "denied") denied.push("Microphone");
      if (cam.state === "denied") denied.push("Camera");
      if (geo.state === "denied") denied.push("Location (GPS)");
      if (mic.state === "granted" && cam.state === "granted" && geo.state === "granted") {
        return true;
      }
    } catch {
      // permissions API not supported — assume ok
      return true;
    }
    if (denied.length > 0) {
      setDeniedList(denied);
      return false;
    }
    return true; // some are 'prompt' — will request on use
  };

  useEffect(() => {
    checkAll().then((ok) => setState(ok ? "granted" : "denied"));
  }, []);

  const requestAll = async () => {
    setState("requesting");
    const failed: string[] = [];
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      if (!micStream) failed.push("Microphone");
      else micStream.getTracks().forEach((t) => t.stop());
    } catch { failed.push("Microphone"); }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
      if (!camStream) failed.push("Camera");
      else camStream.getTracks().forEach((t) => t.stop());
    } catch { failed.push("Camera"); }
    const geoOk = await new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { timeout: 5000 });
    });
    if (!geoOk) failed.push("Location (GPS)");

    if (failed.length === 0) {
      setState("granted");
    } else {
      setDeniedList(failed);
      setState("denied");
    }
  };

  if (state === "checking" || state === "requesting") {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: "#0c0e1a" }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">{state === "requesting" ? "Requesting permissions..." : "Checking permissions..."}</p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="w-full h-screen flex items-center justify-center p-6" style={{ background: "#0c0e1a" }}>
        <div className="max-w-sm w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-white text-xl font-bold mb-2">Permissions Required</h2>
          <p className="text-slate-400 text-sm mb-6">
            KelionAI needs access to microphone, camera, and GPS to function. Without them, the app cannot work.
          </p>
          <div className="flex flex-col gap-2 mb-6">
            {[
              { icon: <Mic className="w-4 h-4" />, label: "Microphone — voice chat" },
              { icon: <Camera className="w-4 h-4" />, label: "Camera — visual analysis" },
              { icon: <MapPin className="w-4 h-4" />, label: "GPS — location & weather" },
            ].map(({ icon, label }) => {
              const name = label.split(" ")[0];
              const isDenied = deniedList.some((d) => d.toLowerCase().includes(name.toLowerCase()));
              return (
                <div key={label} className="flex items-center gap-3 px-4 py-2.5 rounded-lg" style={{ background: isDenied ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${isDenied ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}` }}>
                  <span className={isDenied ? "text-red-400" : "text-green-400"}>{icon}</span>
                  <span className="text-sm text-slate-300">{label}</span>
                  <span className={`ml-auto text-xs font-medium ${isDenied ? "text-red-400" : "text-green-400"}`}>{isDenied ? "Denied" : "OK"}</span>
                </div>
              );
            })}
          </div>
          {deniedList.length > 0 && deniedList.every((d) => true) ? (
            <p className="text-xs text-slate-500 mb-4">
              Some permissions were permanently denied. Please allow them in your browser settings (click the lock icon in the address bar) and refresh the page.
            </p>
          ) : null}
          <button
            onClick={requestAll}
            className="w-full py-3 rounded-xl text-white font-semibold transition-all"
            style={{ background: "#0891b2" }}
          >
            Grant Permissions
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
