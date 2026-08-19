# Chemistry

The study of matter, its properties, and how substances combine, react, and
transform. This page is the hub note. Linked pages: [[Acids and Bases]],
[[Periodic Trends]], [[Lab Equipment]].

## Atoms

The smallest unit of an element that retains its chemical identity. Three
subatomic particles:

- Proton — positive charge, in nucleus, mass ≈ 1 amu
- Neutron — neutral, in nucleus, mass ≈ 1 amu
- Electron — negative charge, in orbitals, mass ≈ 1/1836 amu

### Atomic number vs mass number

Atomic number Z = number of protons. Mass number A = protons + neutrons.
Isotopes share Z but differ in A. See [[Periodic Trends]] for how Z drives
periodicity.

## Bonds

Three primary types of chemical bond:

1. Ionic — full electron transfer between metal and non-metal
2. Covalent — shared electron pair between non-metals
3. Metallic — delocalised "sea" of electrons across a metal lattice

Hydrogen bonding and van der Waals forces are intermolecular, not bonds in
the strict sense, but matter for boiling points and solubility.

## Reactions

A chemical reaction rearranges atoms; the total number of each element is
conserved. Equations must be balanced.

```python
# Compute molar mass given a dictionary of element counts
ATOMIC = {"H": 1.008, "C": 12.011, "N": 14.007, "O": 15.999, "Na": 22.990}

def molar_mass(formula: dict[str, int]) -> float:
    return sum(ATOMIC[el] * n for el, n in formula.items())

# Glucose: C6H12O6
print(molar_mass({"C": 6, "H": 12, "O": 6}))  # → 180.156
```

> "Nothing in life is to be feared, it is only to be understood. Now is the
> time to understand more, so that we may fear less."  — Marie Curie

---

## Lab Notes

Pre-lab checklist before any titration:

- [ ] Goggles + lab coat
- [ ] Buret rinsed with titrant
- [ ] Indicator selected for the expected pH range
- [ ] Stir plate verified
- [x] Logbook open

Reach for [[Lab Equipment]] when unsure which glassware fits a given step.

### Common indicators

| Indicator      | Acidic  | Basic    | pH range  |
| -------------- | ------- | -------- | --------- |
| Methyl orange  | Red     | Yellow   | 3.1 – 4.4 |
| Phenolphthalein| Clear   | Pink     | 8.2 – 10  |
| Bromothymol    | Yellow  | Blue     | 6.0 – 7.6 |

<details>
<summary>Detailed derivation of pH for a weak acid</summary>

For a weak acid HA with concentration C and dissociation constant Ka,
the equilibrium gives [H+]² ≈ Ka · C, so pH ≈ ½ (pKa − log C).

</details>
