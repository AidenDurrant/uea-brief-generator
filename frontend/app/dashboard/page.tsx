"use client";

import { useEffect } from "react";

export default function DashboardRedirect() {
  useEffect(() => {
    window.location.replace("./");
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6 text-center text-slate-700">
      <div>
        <p className="text-sm font-semibold">Opening your dashboard…</p>
        <a href="./" className="mt-3 inline-flex text-sm font-bold text-indigo-700">
          Continue to dashboard
        </a>
      </div>
    </main>
  );
}
