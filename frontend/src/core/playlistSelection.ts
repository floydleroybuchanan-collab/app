import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { PRIMARY_PLAYLIST } from "./playlistCatalog";

let selected: string = PRIMARY_PLAYLIST;
let loaded = false;
let generation = 0;
const listeners = new Set<() => void>();
export function selectPlaylist(id: string) {
  selected = id; generation++; loaded = true;
  void storage.setItem("charm_selected_playlist_v1", id);
  listeners.forEach((listener) => listener());
}
export function useSelectedPlaylist(): string {
  const [value, setValue] = useState(selected);
  useEffect(() => {
    const listener = () => setValue(selected); listeners.add(listener);
    if (!loaded) {
      const epoch = generation;
      void storage.getItem("charm_selected_playlist_v1", PRIMARY_PLAYLIST).then((id) => {
        if (generation !== epoch) return;
        selected = id || PRIMARY_PLAYLIST; loaded = true; listeners.forEach((fn) => fn());
      });
    }
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}
