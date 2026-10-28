/**
 * The smallest projversor page: the sea surface temperature anomaly on the
 * Pacific, with the Niño regions (NOAA CPC) on top.
 */
import { Projversor, type GeoJSONLayerConfig } from "../../src";
import ninoRegions from "./nino-regions.json";

const map = document.getElementById("map")!;
const status = document.getElementById("status")!;

const pv = new Projversor(map, {
  preset: "plate",
  rotate: [160, 0, 0],
  zoom: 1.6,
});
pv.on("status", ({ text }) => (status.textContent = text));

async function main(): Promise<void> {
  await pv.init();
  await pv.add("sst", "scalar", { source: "sea-surface-temperature-anomaly" });
  await pv.add("nino", "geojson", {
    data: ninoRegions as GeoJSONLayerConfig["data"],
    style: { label: "name" },
  });
  // Both layers show: a hook for tests.
  document.body.dataset.ready = "true";
}

main().catch((error: unknown) => {
  console.error(error);
  status.textContent = String(error);
});
