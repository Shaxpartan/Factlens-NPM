import FactLens from "factlens";

const factlens = new FactLens();

async function main() {
  const result = await factlens.verify({
    mode: "text",
    claim: "The Eiffel Tower is in Paris.",
  });

  console.log(result.verdictId, result.explanation);
}

void main();
