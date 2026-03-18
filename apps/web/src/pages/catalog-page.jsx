import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { ProcessGuide } from "@/components/process-guide";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, endpoints } from "@/lib/api";

const PACK_SIZES = [3, 5, 10, 15, 100, 250];

export function CatalogPage() {
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState("new");
  const [filterTerm, setFilterTerm] = useState("");
  const [form, setForm] = useState({
    productId: "",
    name: "",
    strain: "",
    imageUrl: "",
    packSize: "10",
    sku: "",
    barcode: "",
  });

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [productsResponse, variantsResponse] = await Promise.all([
        api(endpoints.products),
        api(endpoints.variants),
      ]);

      setProducts(productsResponse || []);
      setVariants(variantsResponse || []);

      if (!form.productId && productsResponse?.[0]) {
        setForm((current) => ({ ...current, productId: String(productsResponse[0].id) }));
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [form.productId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredVariants = useMemo(() => {
    const term = filterTerm.trim().toUpperCase();

    return variants.filter((variant) => {
      if (!term) return true;
      return (
        String(variant.sku || "").toUpperCase().includes(term) ||
        String(variant.product_name || "").toUpperCase().includes(term)
      );
    });
  }, [filterTerm, variants]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handlePhotoFile(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        throw new Error("El archivo seleccionado no es una imagen");
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
        reader.readAsDataURL(file);
      });

      updateForm("imageUrl", dataUrl);
    } catch (error) {
      toast.error(error.message);
    } finally {
      event.target.value = "";
    }
  }

  async function createVariantFlow(event) {
    event.preventDefault();

    try {
      setIsSaving(true);

      const packSize = Number(form.packSize);
      const sku = form.sku.trim().toUpperCase();
      const barcode = form.barcode.trim();

      if (!sku) throw new Error("SKU obligatorio");

      let productId;

      if (mode === "new") {
        const name = form.name.trim();
        const strain = form.strain.trim();
        const imageUrl = form.imageUrl.trim();
        if (!name) throw new Error("Nombre de producto obligatorio");
        if (!imageUrl) throw new Error("La foto del producto es obligatoria");

        const product = await api(endpoints.products, {
          method: "POST",
          body: JSON.stringify({
            name,
            strain: strain || null,
            imageUrl,
          }),
        });

        productId = product.id;
      } else {
        productId = Number(form.productId);
        if (!productId) throw new Error("Selecciona un producto");
      }

      await api(endpoints.variants, {
        method: "POST",
        body: JSON.stringify({
          productId,
          packSize,
          sku,
          barcode: barcode || null,
        }),
      });

      setForm((current) => ({
        ...current,
        name: "",
        strain: "",
        imageUrl: "",
        sku: "",
        barcode: "",
      }));

      await loadData();
      toast.success("Variante creada correctamente");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catalogo y SKUs"
        description="Gestion de productos, variantes por pack y codigos de escaneo"
        actions={
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </Button>
        }
      />

      <ProcessGuide
        title="Flujo simple de alta de producto"
        description="Pensado para operativa diaria: primero ficha del producto, luego variantes y codigos."
        steps={[
          {
            title: "Crear producto con foto",
            detail: "Nombre + genetica + foto para identificacion visual en picking.",
            tone: "info",
            tag: "obligatorio",
          },
          {
            title: "Crear variantes por pack",
            detail: "Genera 3, 5, 10, 15, 100 y 250 con SKU unico.",
            tone: "info",
            tag: "sku",
          },
          {
            title: "Confirmar codigos",
            detail: "Verifica barcode/SKU para evitar errores en escaneo.",
            tone: "success",
            tag: "control",
          },
          {
            title: "Listo para inventario",
            detail: "Cuando exista la variante, ya puedes cargar stock.",
            tone: "success",
            tag: "siguiente",
          },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Crear variante</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={createVariantFlow}>
              <div className="space-y-2">
                <Label>Modo</Label>
                <Tabs value={mode} onValueChange={setMode}>
                  <TabsList className="w-full">
                    <TabsTrigger value="new" className="flex-1">
                      Producto nuevo
                    </TabsTrigger>
                    <TabsTrigger value="existing" className="flex-1">
                      Producto existente
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {mode === "new" ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nombre producto</Label>
                      <Input
                        id="name"
                        placeholder="Gorilla Glue"
                        value={form.name}
                        onChange={(event) => updateForm("name", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="strain">Genetica / Strain</Label>
                      <Input
                        id="strain"
                        placeholder="Hibrida"
                        value={form.strain}
                        onChange={(event) => updateForm("strain", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">Foto del producto (obligatoria)</Label>
                    <Input
                      id="imageUrl"
                      placeholder="https://... o data:image/..."
                      value={form.imageUrl}
                      onChange={(event) => updateForm("imageUrl", event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="imageFile">O subir foto</Label>
                    <Input id="imageFile" type="file" accept="image/*" onChange={handlePhotoFile} />
                  </div>

                  {form.imageUrl ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <p className="mb-2 text-xs text-muted-foreground">Previsualizacion</p>
                      <img
                        src={form.imageUrl}
                        alt="Preview producto"
                        className="h-24 w-24 rounded-md object-cover ring-1 ring-border/60"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="productId">Producto</Label>
                  <NativeSelect
                    id="productId"
                    value={form.productId}
                    onChange={(event) => updateForm("productId", event.target.value)}
                  >
                    <option value="">Selecciona producto</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pack">Pack</Label>
                  <NativeSelect
                    id="pack"
                    value={form.packSize}
                    onChange={(event) => updateForm("packSize", event.target.value)}
                  >
                    {PACK_SIZES.map((pack) => (
                      <option key={pack} value={pack}>
                        {pack}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    placeholder="GGL-10"
                    value={form.sku}
                    onChange={(event) => updateForm("sku", event.target.value.toUpperCase())}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode (opcional)</Label>
                <Input
                  id="barcode"
                  placeholder="841234567890"
                  value={form.barcode}
                  onChange={(event) => updateForm("barcode", event.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" /> : <Plus />}
                Crear variante
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Productos recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Foto</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Strain</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Sin productos
                    </TableCell>
                  </TableRow>
                ) : (
                  products.slice(0, 18).map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-10 w-10 rounded-md object-cover ring-1 ring-border/60"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-md border border-dashed border-border/60" />
                        )}
                      </TableCell>
                      <TableCell>{product.id}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.strain || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Variantes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Input
              placeholder="Filtrar por SKU o producto"
              value={filterTerm}
              onChange={(event) => setFilterTerm(event.target.value)}
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Foto</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Pack</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVariants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Sin variantes
                  </TableCell>
                </TableRow>
              ) : (
                filteredVariants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell>{variant.id}</TableCell>
                    <TableCell>
                      {variant.product_image ? (
                        <img
                          src={variant.product_image}
                          alt={variant.product_name}
                          className="h-10 w-10 rounded-md object-cover ring-1 ring-border/60"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md border border-dashed border-border/60" />
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{variant.product_strain || variant.product_name}</p>
                      <p className="text-xs text-muted-foreground">{variant.product_name}</p>
                    </TableCell>
                    <TableCell>{variant.pack_size}</TableCell>
                    <TableCell className="font-medium">{variant.sku}</TableCell>
                    <TableCell>{variant.barcode || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
