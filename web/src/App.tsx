import { useEffect, useState } from "react";

type Me = { id: string; username: string };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const failed = new URLSearchParams(window.location.search).get("auth") === "failed";

  useEffect(() => {
    let gone = false;
    fetch("/api/me")
      .then(async (res) => {
        if (gone) return;
        if (!res.ok) {
          setMe(null);
          return;
        }
        setMe((await res.json()) as Me);
      })
      .catch(() => {
        if (!gone) setMe(null);
      });
    return () => {
      gone = true;
    };
  }, []);

  return (
    <main>
      <h1>Ephemera</h1>
      <p>Burn-after-reading handoff.</p>
      {failed ? <p>Sign-in failed.</p> : null}
      {me === undefined ? null : me ? (
        <form action="/api/auth/logout" method="post">
          <p>{me.username}</p>
          <button type="submit">Sign out</button>
        </form>
      ) : (
        <p>
          <a href="/api/auth/discord">Sign in with Discord</a>
        </p>
      )}
    </main>
  );
}
