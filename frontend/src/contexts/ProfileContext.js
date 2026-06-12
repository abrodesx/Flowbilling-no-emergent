import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem("ff-profile") || null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get("/profiles");
        setProfiles(data);
        const stored = localStorage.getItem("ff-profile");
        const valid = stored && data.find((p) => p.id === stored);
        if (valid) {
          setActive(stored);
        } else {
          const def = data.find((p) => p.is_default) || data[0];
          if (def) setActive(def.id);
        }
      } catch (e) { console.error(e); }
    })();
  }, [user]);

  const setActive = (id) => {
    setActiveId(id);
    localStorage.setItem("ff-profile", id);
    api.defaults.headers.common["X-Profile-Id"] = id;
  };

  const refresh = async () => {
    const { data } = await api.get("/profiles");
    setProfiles(data);
  };

  const active = profiles.find((p) => p.id === activeId) || profiles[0];

  return (
    <ProfileContext.Provider value={{ profiles, active, setActive, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
