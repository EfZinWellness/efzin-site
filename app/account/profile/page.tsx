import AccountNav from "@/components/account/AccountNav";
import ProfileForm from "@/components/account/ProfileForm";
import { loadProfile } from "@/lib/account/profile";
import { requirePerson } from "@/lib/auth/session";
import { getSqlClient } from "@/lib/db/client";

export const metadata = { title: "Profile | My Ef Zin", robots: { index: false } };

export default async function ProfilePage() {
  const me = await requirePerson();
  const db = await getSqlClient();
  const profile = (db ? await loadProfile(db, me.personId) : null) ?? {
    name: "",
    email: me.email,
    phone: "",
    marketingConsent: false,
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-20 pt-10">
      <h1 className="text-center font-serif text-3xl">Profile</h1>
      <AccountNav current="/account/profile" />
      <div className="mt-8">
        <ProfileForm profile={profile} />
      </div>
    </div>
  );
}
