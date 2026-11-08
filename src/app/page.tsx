import { headers } from "next/headers";
import Image from "next/image";
import { after } from "next/server";
import { IconHeart, IconSparkles } from "@tabler/icons-react";
import { ContactAccess } from "@/components/contact-access";
import { ContactLink } from "@/components/contact-link";
import { getPublicContacts } from "@/lib/server/config";
import { notifyVisit } from "@/lib/server/notifications";
import { ShareButton } from "@/components/share-button";
import { isKnownCrawler } from "@/lib/server/request";
import { profile } from "@/profile";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const crawler = isKnownCrawler(requestHeaders.get("user-agent") ?? "");
  const notificationHeaders = new Headers(requestHeaders);
  after(() => notifyVisit(notificationHeaders).then(() => {}));
  const publicContacts = getPublicContacts();

  return <div className="site-shell">
    <div className="ambient-light" aria-hidden="true" />
    <header className="site-header">
      <span className="header-flourish" aria-hidden="true"><IconSparkles size={23} stroke={1.3} /></span>
      {!crawler && <ShareButton name={profile.name} />}
    </header>
    <main id="main" className="profile-layout">
      <div className="profile-intro">
        <div className="avatar-ring"><div className="avatar"><Image src={profile.avatar} alt={`${profile.name}'s profile picture`} width={116} height={116} sizes="116px" preload className="avatar-photo" /></div><span className="avatar-heart" aria-hidden="true"><IconHeart size={17} stroke={1.6} /></span></div>
        <h1>{profile.name}</h1>
        <section className="about-section" aria-labelledby="about-heading">
          <h2 id="about-heading" className="sr-only">A bit about me</h2>
          <p className="profile-bio">{profile.bio}</p>
        </section>
      </div>
      {!crawler && <ContactAccess />}
      <section className="public-contacts" aria-labelledby="public-links-heading">
        <div className="section-heading"><h2 id="public-links-heading">Find me here</h2></div>
        <div className="contact-list">{publicContacts.map(contact => <ContactLink key={contact.id} contact={contact} />)}</div>
      </section>
    </main>
    <footer className="profile-footer"><IconHeart size={13} stroke={1.5} aria-hidden="true" /><span>A little style. A little sparkle.</span></footer>
  </div>;
}
