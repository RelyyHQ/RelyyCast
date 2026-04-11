import { useEffect } from "react";
import { filesystem } from "@neutralinojs/lib";
import { StationConsole } from "@/components/station-console";

const REDIRECT_PATHS = new Set(["/login", "/stations"]);

export default function App() {
  useEffect(() => {
    if (!REDIRECT_PATHS.has(window.location.pathname)) {
      // Continue with runtime probe below.
    } else {
      window.history.replaceState({}, "", "/");
    }

    if (!window.Neutralino) {
      return;
    }

    filesystem
      .readDirectory("./")
      .then((data) => {
        console.info("[App] Neutralino filesystem.readDirectory('./')", data);
      })
      .catch((error) => {
        console.warn("[App] Neutralino filesystem.readDirectory failed", error);
      });
  }, []);

  return <StationConsole />;
}
