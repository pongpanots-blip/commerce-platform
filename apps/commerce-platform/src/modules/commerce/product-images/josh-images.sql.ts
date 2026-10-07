/** josh's galleries → `{ sku, images }` (image rows in display order; SKUs without images get []). Import and parity read it. */
export const JOSH_IMAGES_SQL = `SELECT p.product_inventory_sku AS sku,
    COALESCE((SELECT jsonb_agg(m.source ORDER BY m.sort_order, m.created_at) FROM product_media m
      WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image'), '[]'::jsonb) AS images
  FROM product_inventory p`;
