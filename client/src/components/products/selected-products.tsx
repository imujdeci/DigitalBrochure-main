import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Product, CampaignProduct } from "@shared/schema";

interface SelectedProductsProps {
  products: (CampaignProduct & { product: Product })[];
  onProductUpdate: (id: number, updates: Partial<CampaignProduct>) => void;
  onProductRemove: (id: number) => void;
}

export default function SelectedProducts({
  products,
  onProductUpdate,
  onProductRemove,
}: SelectedProductsProps) {
  const calculateNewPrice = (
    originalPrice: number,
    discountPercent: number
  ) => {
    return originalPrice * (1 - discountPercent / 100);
  };

  const handleQuantityChange = (id: number, quantity: number) => {
    onProductUpdate(id, { quantity });
  };

  const handleDiscountChange = (
    id: number,
    discountPercent: number,
    originalPrice: number
  ) => {
    const newPrice = calculateNewPrice(originalPrice, discountPercent);
    onProductUpdate(id, { discountPercent, newPrice });
  };

  const handleDisplayNameChange = (id: number, value: string) => {
    // Store an override name for rendering in the editor
    onProductUpdate(id, { ...(null as any), displayName: value } as any);
  };

  const handleOriginalPriceOverride = (
    id: number,
    value: string,
    fallback: number
  ) => {
    const price = value === "" ? fallback : parseFloat(value);
    if (!isNaN(price) && price >= 0) {
      onProductUpdate(id, {
        ...(null as any),
        originalPriceOverride: price,
      } as any);
    }
  };

  const handleNewPriceChange = (
    id: number,
    value: string,
    originalPrice: number
  ) => {
    const price = value === "" ? 0 : parseFloat(value);
    if (!isNaN(price) && price >= 0) {
      // When user sets new price manually, also refresh discount percent accordingly
      const discountPercent =
        originalPrice > 0
          ? Math.max(0, Math.min(100, (1 - price / originalPrice) * 100))
          : 0;
      onProductUpdate(id, { newPrice: price, discountPercent });
    }
  };

  return (
    <div className="h-full flex flex-col relative z-10">
      <div className="p-6 border-b border-gray-200 bg-white">
        <h2 className="text-xl font-semibold text-gray-900">
          Selected Products
        </h2>
      </div>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {products.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No products selected</p>
            <p className="text-sm text-gray-400 mt-1">
              Add products from the search panel
            </p>
          </div>
        ) : (
          products.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl p-4 border border-gray-200 relative z-20 shadow-sm"
            >
              <div className="flex items-center space-x-4 mb-3">
                {item.product.imageUrl && (
                  <img
                    src={item.product.imageUrl}
                    alt={item.product.name}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">
                    {item.product.name}
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 p-0 h-auto"
                    onClick={() => onProductRemove(item.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Remove
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {/* Editable display name */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Product Name:</span>
                  <Input
                    type="text"
                    value={(item as any).displayName ?? item.product.name}
                    onChange={(e) =>
                      handleDisplayNameChange(item.id, e.target.value)
                    }
                    className="w-44 text-sm"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Original Price:</span>
                  <Input
                    type="number"
                    value={
                      (item as any).originalPriceOverride ??
                      item.product.originalPrice
                    }
                    onChange={(e) =>
                      handleOriginalPriceOverride(
                        item.id,
                        e.target.value,
                        item.product.originalPrice
                      )
                    }
                    className="w-24 text-center"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Quantity:</span>
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      handleQuantityChange(
                        item.id,
                        parseInt(e.target.value) || 1
                      )
                    }
                    className="w-16 text-center"
                    min="1"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Discount:</span>
                  <div className="flex items-center space-x-1">
                    <Input
                      type="number"
                      value={item.discountPercent}
                      onChange={(e) => {
                        const value = e.target.value;
                        const discount = value === "" ? 0 : parseFloat(value);
                        if (
                          !isNaN(discount) &&
                          discount >= 0 &&
                          discount <= 100
                        ) {
                          handleDiscountChange(
                            item.id,
                            discount,
                            (item as any).originalPriceOverride ??
                              item.product.originalPrice
                          );
                        }
                      }}
                      className="w-16 text-center"
                      min="0"
                      max="100"
                      step="0.1"
                    />
                    <span className="text-sm">%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-sm font-semibold text-gray-900">
                    New Price:
                  </span>
                  <Input
                    type="number"
                    value={item.newPrice}
                    onChange={(e) =>
                      handleNewPriceChange(
                        item.id,
                        e.target.value,
                        (item as any).originalPriceOverride ??
                          item.product.originalPrice
                      )
                    }
                    className="w-24 text-center font-bold"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
