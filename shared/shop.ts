export type HatId = "cowboy" | "safari" | "astronaut" | "sunglasses";

export type ShopHat = {
  id: HatId;
  name: string;
  priceLamports: number;
  description: string;
};

export const SHOP_HATS: ShopHat[] = [
  {
    id: "cowboy",
    name: "Cowboy Hat",
    priceLamports: 0.2 * 1_000_000_000,
    description: "Classic cowboy brim.",
  },
  {
    id: "safari",
    name: "Safari Hat",
    priceLamports: 0.25 * 1_000_000_000,
    description: "Explorer vibes.",
  },
  {
    id: "astronaut",
    name: "Astronaut Helmet",
    priceLamports: 0.35 * 1_000_000_000,
    description: "Space-ready visor.",
  },
  {
    id: "sunglasses",
    name: "Sunglasses",
    priceLamports: 0.15 * 1_000_000_000,
    description: "Stay cool.",
  },
];

export function getHatById(id: string) {
  return SHOP_HATS.find((hat) => hat.id === id);
}
