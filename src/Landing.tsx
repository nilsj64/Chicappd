import { useI18n } from "./LanguageProvider";
import Brand, { BrandMark } from "./Brand";
import { Icon, SuitIcon } from "./Icon";
import AccountControl from "./AccountControl";
import { API_URL } from "./online";

const cardBackAsset = (appearance: "light" | "dark") =>
  `${import.meta.env.BASE_URL}Chicappd-brand-assets/Chicappd-card-backs/card-back-${appearance}.svg`;

export default function Landing({ onEnter, onPhysical, onHistory }: { onEnter: (mode: "create" | "join" | null) => void; onPhysical: () => void; onHistory: () => void }) {
  const { t } = useI18n();
  return (
    <div className="landing-page">
      <header className="landing-header page-width">
        <Brand />
        <span className="header-note">
          {t("Kortkväll tillsammans, var ni än är")}{" "}<span><BrandMark /></span>
        </span>
        <AccountControl />
      </header>
      <main className="landing-main page-width">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" /> {" "}{t("ETT SPEL FÖR DITT GÄNG")}</div>
          <h1>
            {t("Samla vännerna")}<br />
            {t("runt")}{" "}<em>{t("bordet.")}</em>
          </h1>
          <p>
            {t("Samla vännerna kring ett digitalt kortbord. Skapa ett rum och börja spela tillsammans.")}</p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              onClick={() => onEnter("create")}
            >
              {t("Skapa spel")}{" "}<Icon name="arrow-up-right" />
            </button>
            {API_URL && <button
              className="button button-secondary"
              onClick={() => onEnter("join")}
            >
              {t("Gå med i spel")}{" "}<Icon name="arrow-right" />
            </button>}
          </div>
          <div className="hero-footnote">
            <span className="footnote-icon"><BrandMark /></span> {API_URL
              ? t("Onlinerum för upp till sex mänskliga spelare") : t("Spela lokalt med upp till tre CPU-spelare")}
          </div>
          <nav className="landing-history" aria-label={t("Poäng och historik")}>
            <span className="form-kicker">{t("POÄNG OCH HISTORIK")}</span>
            <button onClick={onPhysical}><span>{t("Fysiska kort")}<small>{t("Poängräknare och sparade matcher")}</small></span><Icon name="arrow-right" /></button>
            <button onClick={onHistory}><span>{t("Digital spelarstatistik")}<small>{t("Dina resultat och bästa händer")}</small></span><Icon name="arrow-right" /></button>
          </nav>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-label art-label-top">{t("FEM KORT. ETT BORD.")}</div>
          <div className="art-card art-card-back" style={{ backgroundImage: `url(${cardBackAsset("light")})` }} />
          <div className="art-card art-card-heart">
            <span className="art-corner">
              A<br /><SuitIcon suit="hearts" />
            </span>
            <span className="art-suit"><SuitIcon suit="hearts" /></span>
          </div>
          <div className="art-card art-card-spade">
            <span className="art-corner">
              K<br /><SuitIcon suit="spades" />
            </span>
            <span className="art-suit"><SuitIcon suit="spades" /></span>
          </div>
          <div className="art-label art-label-bottom">
            {t("KORTKVÄLLEN BÖRJAR HÄR")}{" "}<span><Icon name="arrow-up-right" /></span>
          </div>
        </div>
      </main>
      <footer className="landing-footer page-width">
        <span className="suit-row"><SuitIcon suit="spades" /><SuitIcon suit="hearts" />
          <SuitIcon suit="diamonds" /><SuitIcon suit="clubs" /></span>
        <span>{t("För spelkvällar tillsammans.")}</span>
      </footer>
    </div>
  );
}

