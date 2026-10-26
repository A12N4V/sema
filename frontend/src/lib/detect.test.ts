import { describe, expect, it } from "vitest";
import { detect, tableRole } from "./detect";

const text = (name: string, body: string) => new File([body], name, { type: "text/plain" });
const bytes = (name: string, b: number[]) => new File([new Uint8Array(b)], name);
const HDF5 = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

const COUNTS = "gene_id\tgene_name\tV1\tV2\tT1\tT2\nENSMUSG01\tGad1\t10\t12\t40\t38\n";
const META = "sample,group,sex,batch\nV1,V,F,1\nT1,T,M,1\n";

describe("detect", () => {
  it("routes MNE-readable recordings to Sema", async () => {
    expect((await detect([bytes("sub-01.edf", [0, 1, 2])])).kind).toBe("eeg");
    expect((await detect([text("run.vhdr", "Brain Vision")])).kind).toBe("eeg");
    expect((await detect([bytes("raw.fif.gz", [1])])).kind).toBe("eeg");
  });

  it("routes HDF5 single-cell files to Karyon and refuses a mislabelled .h5", async () => {
    const d = await detect([bytes("A1_filtered.h5", HDF5), bytes("A2_filtered.h5", HDF5)]);
    expect(d.kind).toBe("snrna");
    expect(d.kind === "snrna" && d.files.length).toBe(2);
    expect((await detect([bytes("fake.h5", [1, 2, 3, 4, 5, 6, 7, 8])])).kind).toBe("unknown");
  });

  it("tells a counts matrix from a sample sheet", async () => {
    expect(await tableRole(text("gene_count.xls", COUNTS))).toBe("counts");
    expect(await tableRole(text("metadata.csv", META))).toBe("metadata");
    expect(await tableRole(text("DG_cell_type_signatures.csv", "a,b\n1,2\n"))).toBe("signatures");
    expect(await tableRole(text("notes.csv", "title,author\nx,y\n"))).toBeNull();
  });

  it("routes tables to Plethos and names what is still missing", async () => {
    const d = await detect([text("gene_count.xls", COUNTS)]);
    expect(d.kind).toBe("bulk");
    expect(d.kind === "bulk" && d.missing).toEqual(["metadata"]);
    const both = await detect([text("gene_count.xls", COUNTS), text("metadata.csv", META)]);
    expect(both.kind === "bulk" && both.missing).toEqual([]);
  });

  it("says why when it cannot tell", async () => {
    const d = await detect([text("readme.md", "# hi")]);
    expect(d.kind).toBe("unknown");
  });
});
