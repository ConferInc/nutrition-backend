// B2C-012: Grocery list export (CSV)
import Papa from "papaparse";
import { getGroceryListDetail } from "./groceryList.js";

interface ExportRow {
  "Item Name": string;
  Quantity: string;
  Unit: string;
  Category: string;
  "Estimated Price": string;
  Purchased: string;
}

/**
 * Export a grocery list as CSV text.
 *
 * Uses the existing `getGroceryListDetail` function to leverage
 * ownership verification and item resolution.
 */
export async function exportGroceryListAsCsv(
  b2cCustomerId: string,
  listId: string
): Promise<{ csv: string; filename: string }> {
  const detail = await getGroceryListDetail(b2cCustomerId, listId);

  const rows: ExportRow[] = detail.items.map((item: any) => ({
    "Item Name": item.itemName ?? "",
    Quantity: item.quantity != null ? String(item.quantity) : "",
    Unit: item.unit ?? "",
    Category: item.category ?? "",
    "Estimated Price":
      item.estimatedPrice != null
        ? `$${Number(item.estimatedPrice).toFixed(2)}`
        : "",
    Purchased: item.isPurchased ? "Yes" : "No",
  }));

  const csv = Papa.unparse(rows, {
    header: true,
    columns: [
      "Item Name",
      "Quantity",
      "Unit",
      "Category",
      "Estimated Price",
      "Purchased",
    ],
  });

  const safeName = (detail.list.listName ?? "grocery-list")
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .substring(0, 50);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}_${dateStr}.csv`;

  return { csv, filename };
}
