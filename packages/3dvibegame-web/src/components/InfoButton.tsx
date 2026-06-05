import { useState } from "react";

const shortcuts = [
  ["W A S D", "Move the camera, or move the selected object on the ground."],
  ["Q / E", "Move the selected object up or down."],
  ["Esc", "Deselect the current object."],
  ["Cmd/Ctrl + C", "Copy the selected object."],
  ["Cmd/Ctrl + V", "Paste a copied object."],
  ["Delete / Backspace", "Open delete confirmation for the selected object."],
  ["Enter", "Confirm delete while the confirmation modal is open."],
] as const;

export function InfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label="Open game info"
        className="info-button"
        onClick={() => setOpen(true)}
        title="Game info"
        type="button"
      >
        i
      </button>

      {open && (
        <div className="modal-overlay">
          <div className="modal-card info-modal">
            <div className="info-modal-header">
              <h2 className="modal-title">3dvibegame</h2>
              <button
                aria-label="Close game info"
                className="info-modal-close"
                onClick={() => setOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <p className="modal-description">
              A shared 3D world where players create, move, remix, duplicate,
              and delete AI-built voxel objects.
              <br />
              <br />
              <i>Works best on Desktop</i>
              <br />
              <br />
            </p>
            <section className="info-section" aria-labelledby="info-shortcuts">
              <h3 id="info-shortcuts">Keyboard Shortcuts</h3>
              <dl className="shortcut-list">
                {shortcuts.map(([keys, description]) => (
                  <div className="shortcut-row" key={keys}>
                    <dt>{keys}</dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <p className="modal-description">
              View source on{" "}
              <a
                className="info-link"
                href="https://github.com/gianpaj/3dvibegame"
                rel="noreferrer"
                target="_blank"
              >
                https://github.com/gianpaj/3dvibegame
              </a>
            </p>
            <p className="modal-description small">
              Created by Gianfranco{" "}
              <a
                className="info-link"
                href="https://github.com/gianpaj"
                rel="noreferrer"
                target="_blank"
              >
                @gianpaj
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
