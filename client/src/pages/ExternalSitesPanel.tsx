import { Globe, Plus, Trash2 } from "lucide-react";
import type { Service, ServiceState } from "@/lib/tmp-data";

type Props = {
  sites: Service[];
  onStatusChange: (site: Service, state: ServiceState) => void;
  onDelete: (site: Service) => void;
  onAdd: () => void;
};

export default function ExternalSitesPanel({ sites, onStatusChange, onDelete, onAdd }: Props) {
  return (
    <section className="external-sites-panel">
      <div className="external-sites-heading">
        <div>
          <p className="eyebrow">BROWSER-LOCAL REGISTRY</p>
          <h2>Off-platform sites</h2>
        </div>
        <button className="button secondary" onClick={onAdd}>
          <Plus size={15} /> Add external site
        </button>
      </div>
      <p className="route-help">
        These entries are only saved in this browser. Their Running, Degraded, or Stopped label is manual; it does not check, deploy, start, stop, or delete anything on the external host.
      </p>
      {sites.length ? (
        <div className="website-grid">
          {sites.map(site => (
            <article className="website-card external-site-card" key={site.id}>
              <div className="website-card-head">
                <div>
                  <p className="eyebrow">OFF-PLATFORM · MANUAL</p>
                  <h3>{site.name}</h3>
                </div>
                <span className={`status-dot ${site.state === "restarting" ? "running" : site.state}`} aria-label={`Displayed status: ${site.state}`} />
              </div>
              {site.domain ? (
                <a className="website-domain external-site-domain" href={`https://${site.domain}`} target="_blank" rel="noreferrer">{site.domain}</a>
              ) : (
                <p className="website-domain external-site-domain">No hostname recorded</p>
              )}
              <div className="external-site-controls">
                <label className="field-label">
                  Display status
                  <select
                    aria-label={`Displayed status for ${site.name}`}
                    value={site.state === "restarting" ? "running" : site.state}
                    onChange={event => onStatusChange(site, event.target.value as ServiceState)}
                  >
                    <option value="running">Running</option>
                    <option value="degraded">Degraded</option>
                    <option value="stopped">Stopped</option>
                  </select>
                </label>
                <button className="button danger-button" onClick={() => onDelete(site)}>
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="cloud-empty external-sites-empty">
          <Globe size={22} />
          <p>No off-platform Web app entries are saved in this browser. Add one here with its site name and optional hostname; its card will let you set the displayed status.</p>
        </div>
      )}
    </section>
  );
}
