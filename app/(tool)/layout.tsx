import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth";
import { signedUrls } from "@/lib/data";
import { serviceClient } from "@/lib/supabase/service";
import { NavLinks } from "@/components/NavLinks";
import { UserMenu } from "@/components/UserMenu";
export default async function ToolLayout({ children }: { children: React.ReactNode }) {
  const me = await requireSuperadmin();
  const avatars = me.avatarPath ? await signedUrls(serviceClient(), "humor-avatars", [me.avatarPath], 3600) : {};
  const adminUrl = process.env.HUMOR_ADMIN_URL?.startsWith("https://") ? process.env.HUMOR_ADMIN_URL : null;
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">h.</span>
          <span>Prompt Chain Tool<small>Superadmin</small></span>
        </Link>
        <NavLinks />
        <div className="topbar-end">
          <UserMenu name={me.name ?? (me.username ? `@${me.username}` : me.email ?? "Superadmin")} email={me.email}
            avatarUrl={me.avatarPath ? avatars[me.avatarPath] ?? null : null} adminUrl={adminUrl} />
        </div>
      </header>
      <main className="main">{children}</main>
    </>
  );
}
