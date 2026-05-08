(function initBusinessPageLayer() {
function renderBusinessPackages() {
  const root = document.getElementById("businessPackageGrid");
  if (!root) return;
  root.innerHTML = window.LuminaStaticData.businessPackages.map(item => `
    <article class="package-card">
      <span class="eyebrow">${item.target}</span>
      <strong>${item.name}</strong>
      <p>${item.summary}</p>
      <ul class="package-list">${item.deliverables.map(d => `<li>${d}</li>`).join("")}</ul>
    </article>`).join("");
}

window.renderBusinessPackages = renderBusinessPackages;
})();
