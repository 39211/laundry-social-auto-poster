import type { CarouselItem, DailySlot } from "./types";

export interface SlotImageAsset {
  slide: number;
  image_prompt: string;
  local_image_path: string;
  public_image_url: string;
}

export function imageAssetsForSlot(slot: DailySlot): SlotImageAsset[] {
  if (slot.media_type === "carousel" || slot.media_type === "mixed-carousel") {
    const items = slot.carousel_items ?? [];
    if (items.length < 2 || items.length > 10) {
      throw new Error(`Carousel slot ${slot.slot} must contain 2-10 image items.`);
    }
    const slides = items.map((item) => item.slide);
    if (new Set(slides).size !== slides.length || slides.some((slide) => slide < 1)) {
      throw new Error(`Carousel slot ${slot.slot} has invalid or duplicate slide numbers.`);
    }
    return [...items].sort((a, b) => a.slide - b.slide);
  }

  return [
    {
      slide: 1,
      image_prompt: slot.image_prompt,
      local_image_path: slot.local_image_path,
      public_image_url: slot.public_image_url
    }
  ];
}

export function carouselItemsForSlot(slot: DailySlot): CarouselItem[] {
  if (slot.media_type !== "carousel" && slot.media_type !== "mixed-carousel") return [];
  return imageAssetsForSlot(slot);
}
