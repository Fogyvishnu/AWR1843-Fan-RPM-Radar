#!/usr/bin/env python3
"""
TI mmWave Multicore Image Generator for Linux
----------------------------------------------
Converts ELF executables (.xer4f, .xe674) into TI RPRC format
and packages them with BSS firmware into a unified multicore .bin
image for flashing via TI UniFlash.

Author: Embedded Radar Engineering Team
Target: TI AWR1843BOOST (Cortex-R4F + C674x DSP + BSS)
"""

import os
import sys
import struct
import subprocess
import shutil
from pathlib import Path
from elftools.elf.elffile import ELFFile
from elftools.elf.constants import SH_FLAGS

MMWAVE_SDK_PATH = os.environ.get("MMWAVE_SDK_INSTALL_PATH", "/home/vish/ti/mmwave_sdk_03_06_02_00-LTS")
MULTCOREGEN = Path(MMWAVE_SDK_PATH) / "packages/scripts/ImageCreator/multicore_image_generator/MulticoreImageGen"
CRC_MULTI = Path(MMWAVE_SDK_PATH) / "packages/scripts/ImageCreator/crc_multicore_image/crc_multicore_image"
GEN_BINCRC32 = Path(MMWAVE_SDK_PATH) / "packages/scripts/ImageCreator/append_bin_crc/gen_bincrc32"
BSS_FW = Path(MMWAVE_SDK_PATH) / "firmware/radarss/xwr18xx_radarss_rprc.bin"

# TI Subsystem Core IDs
MSS_CORE_ID = "0x35510000"
BSS_CORE_ID = "0xb5510000"
DSS_CORE_ID = "0xd5510000"
SHMEM_ALLOC_1843 = "0x00000008"

def elf_to_rprc(elf_path: Path, rprc_path: Path):
    """
    Extracts loadable sections from an ELF executable and formats
    them into a TI RPRC binary image.
    """
    with open(elf_path, 'rb') as f:
        elf = ELFFile(f)
        entry_point = elf.header['e_entry']
        segments = [seg for seg in elf.iter_segments() if seg['p_type'] == 'PT_LOAD' and seg['p_filesz'] > 0]
        
        loadable_sections = []
        for sec in elf.iter_sections():
            if sec['sh_type'] == 'SHT_NOBITS' or sec['sh_size'] == 0:
                continue
            if not (sec['sh_flags'] & SH_FLAGS.SHF_ALLOC):
                continue
            
            sec_off = sec['sh_offset']
            sec_sz = sec['sh_size']
            matched_seg = None
            for seg in segments:
                if seg['p_offset'] <= sec_off and (sec_off + sec_sz) <= (seg['p_offset'] + seg['p_filesz']):
                    matched_seg = seg
                    break
            
            if matched_seg is not None:
                load_addr = matched_seg['p_paddr'] + (sec_off - matched_seg['p_offset'])
                loadable_sections.append((sec.name, load_addr, sec_sz, sec.data()))

    print(f"[*] Processing {elf_path.name}: Entry 0x{entry_point:08x}, {len(loadable_sections)} loadable sections.")
    
    with open(rprc_path, 'wb') as out:
        # Magic: 'RPRC' = 0x43525052
        # Header (24 bytes): Magic, EntryPointLo, EntryPointHi, NumSections, Version(1), Reserved(0)
        out.write(struct.pack('<IIIIII', 0x43525052, entry_point, 0, len(loadable_sections), 1, 0))
        
        for name, addr, sz, data in loadable_sections:
            # Section Header (24 bytes): LoadAddrLo, LoadAddrHi, Size, Rsvd0, Rsvd1, Rsvd2
            out.write(struct.pack('<IIIIII', addr, 0, sz, 0, 0, 0))
            out.write(data)
            # Pad section data to 8-byte boundary
            pad_len = (8 - (sz % 8)) % 8
            if pad_len > 0:
                out.write(b'\x00' * pad_len)

    print(f"[+] Created RPRC image: {rprc_path} ({rprc_path.stat().st_size} bytes)")

def package_multicore(mss_elf: Path, dss_elf: Path, out_bin: Path):
    """
    Combines MSS, DSS, and BSS into a single TI MetaImage .bin for UniFlash.
    """
    tmp_dir = Path("/tmp/ti_image_build")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    
    mss_rprc = tmp_dir / "mss.rprc"
    dss_rprc = tmp_dir / "dss.rprc"
    tmp_bin = tmp_dir / out_bin.name
    temp_crc_file = tmp_dir / f"{out_bin.name}.tmp"
    
    elf_to_rprc(mss_elf, mss_rprc)
    elf_to_rprc(dss_elf, dss_rprc)
    
    if not BSS_FW.exists():
        raise FileNotFoundError(f"BSS firmware not found at {BSS_FW}")
    
    print(f"[*] Running MulticoreImageGen...")
    cmd = [
        str(MULTCOREGEN), "LE", "37", SHMEM_ALLOC_1843, str(tmp_bin),
        MSS_CORE_ID, str(mss_rprc),
        BSS_CORE_ID, str(BSS_FW),
        DSS_CORE_ID, str(dss_rprc)
    ]
    subprocess.run(cmd, check=True)
    
    print(f"[*] Updating CRC tables...")
    subprocess.run([str(CRC_MULTI), str(tmp_bin), str(temp_crc_file)], check=True)
    
    print(f"[*] Appending binary CRC32 checksum...")
    subprocess.run([str(GEN_BINCRC32), str(tmp_bin)], check=True)
    
    out_bin.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(tmp_bin, out_bin)
    print(f"[SUCCESS] Flashing image created: {out_bin} ({out_bin.stat().st_size} bytes)")
    
    # Cleanup temp files
    if temp_crc_file.exists():
        temp_crc_file.unlink()

if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    mss_elf_path = repo_root / "out_of_box_1843_mss/isk/out_of_box_1843_mss_isk.xer4f"
    dss_elf_path = repo_root / "out_of_box_1843_dss/isk/out_of_box_1843_dss_isk.xe674"
    output_bin_path = repo_root / "prebuilt_binaries/awr1843_fan_rpm.bin"
    
    if not mss_elf_path.exists():
        print(f"Error: MSS binary not found: {mss_elf_path}")
        sys.exit(1)
    if not dss_elf_path.exists():
        print(f"Error: DSS binary not found: {dss_elf_path}")
        sys.exit(1)
        
    package_multicore(mss_elf_path, dss_elf_path, output_bin_path)
