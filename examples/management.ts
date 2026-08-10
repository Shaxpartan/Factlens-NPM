import FactLens from "factlens";

const factlens = new FactLens();

async function main() {
  const project = await factlens.projects.create({ name: "Production" });
  factlens.projects.select(project.id);

  const created = await factlens.keys.create({ label: "Backend" });
  console.log(created.api_key); // Shown once. Move it to server-side secret storage.

  const usage = await factlens.usage.getAccount();
  const logs = await factlens.logs.list({ limit: 10 });
  console.log(usage.account, logs.logs);
}

void main();
