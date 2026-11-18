/* Fallback line icons, shown when a product has no photo. Catalogue data now lives in the database (see server/). */
window.MPM_ICONS = (() => {
  // Line icons (64×64, stroke-based so they inherit brand colours)
  const s = (d) => `<svg viewBox="0 0 64 64" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    pot: s('<path d="M10 26h44v6a18 18 0 0 1-18 18h-8a18 18 0 0 1-18-18z"/><path d="M5 26h54M24 20c0-5 16-5 16 0"/>'),
    pan: s('<circle cx="26" cy="34" r="17"/><circle cx="26" cy="34" r="9"/><path d="M43 34h17"/>'),
    glass: s('<path d="M18 10h28l-4 44H22z"/><path d="M19.5 24h25"/>'),
    plate: s('<circle cx="32" cy="32" r="23"/><circle cx="32" cy="32" r="13"/>'),
    mop: s('<path d="M42 6 30 40"/><path d="M18 40h22l6 16H12z"/><path d="M20 48l-2 8M29 48v8M38 48l2 8"/>'),
    spray: s('<path d="M22 26h16l5 9v21H17V35z"/><path d="M26 26v-9h12l7 4M48 14l4-2M49 19h5M48 24l4 2M26 17h-5"/>'),
    sponge: s('<rect x="8" y="22" width="48" height="22" rx="6"/><path d="M8 31h48"/><circle cx="20" cy="38" r="1.5"/><circle cx="31" cy="39" r="1.5"/><circle cx="43" cy="38" r="1.5"/>'),
    broom: s('<path d="M46 6 31 33"/><path d="M23 29l17 9-7 18-23-11z"/><path d="M18 50l6-11M26 54l6-11"/>'),
    bin: s('<path d="M13 18h38M26 18v-6h12v6M18 18l3 38h22l3-38M28 27v20M36 27v20"/>'),
    towel: s('<rect x="14" y="10" width="36" height="44" rx="4"/><path d="M14 22h36M14 44h36M22 32h20"/>'),
    soap: s('<path d="M20 28h24v26a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z"/><path d="M28 28v-8h8v8M32 20v-8h11"/><path d="M26 41h12"/>'),
    roll: s('<ellipse cx="22" cy="32" rx="9" ry="18"/><path d="M22 14h22c5 0 9 8 9 18s-4 18-9 18H22"/><circle cx="22" cy="32" r="3"/>'),
    box: s('<path d="M8 20 32 8l24 12v24L32 56 8 44z"/><path d="M8 20l24 12 24-12M32 32v24"/>'),
    container: s('<rect x="10" y="25" width="44" height="27" rx="5"/><rect x="7" y="17" width="50" height="8" rx="3"/><path d="M22 38h20"/>'),
    basket: s('<path d="M8 26h48l-6 28H14z"/><path d="M18 26 28 10M46 26 36 10M22 34v12M32 34v12M42 34v12"/>'),
    hanger: s('<path d="M32 23v-4a5.5 5.5 0 1 0-5.5-5.5"/><path d="M32 23 6 42a3 3 0 0 0 2 5h48a3 3 0 0 0 2-5z"/>'),
    candle: s('<rect x="20" y="27" width="24" height="29" rx="4"/><path d="M32 27v-6"/><path d="M32 7c5 5 5 10 0 13-5-3-5-8 0-13z"/>'),
    lamp: s('<path d="M19 30 25 8h14l6 22z"/><path d="M32 30v18M20 56h24M25 48h14"/>'),
    kettle: s('<path d="M16 54h32l-4-30H20z"/><path d="M20 24c0-8 24-8 24 0M28 13h8M44 30c8 0 10 12 2 16M17 31l-9-6"/>'),
    blender: s('<path d="M20 8h24l-4 30H24z"/><path d="M44 14h6v14h-8M18 38h28l2 16H16z"/><circle cx="32" cy="47" r="2.5"/>'),
    cup: s('<path d="M16 16h32l-4 40H20z"/><path d="M13 10h38v6H13zM18 30h28"/>'),
  };

  return ICONS;
})();
