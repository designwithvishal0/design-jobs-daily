import assert from "assert";
import { isDesignRole } from "./fetch-jobs.mjs";

for (const t of ["UI/UX Designer", "Product Designer", "Founding Product Designer", "Product Designer (2 - 4yrs experience)", "UX Designer", "Brand & Product Designer"])
  assert.ok(isDesignRole(t), t);
for (const t of ["Physical Design Automation Engineer", "Product Design Engineer", "CAD & Creo Design Engineer", "Toy Designer - Plush/Soft Toys", "Industrial Designer", "Visual Designer ( Interactives )", "Product Designer (Internship)", "Designer / Design Engineer", "Product Designer- Luxury Lighting"])
  assert.ok(!isDesignRole(t), t);
console.log("filter ok");
assert.equal(isDesignRole("Junior Product Designer - Intership Paris"), false);
