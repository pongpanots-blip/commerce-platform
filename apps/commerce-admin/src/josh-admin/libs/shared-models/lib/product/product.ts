export interface Product {
    data:any
  id: number;
  name:string;
  price:number;
  createdAt?: string;
  updatedAt?: string;
  imageUrl?:string;
  description?:string;
  rating: number;
  tags: string[];
  media:any;
  product_id:any;
  inventory:any;

}
