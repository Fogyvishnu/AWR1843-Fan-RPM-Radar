################################################################################
# Automatically-generated file. Do not edit!
################################################################################

# Each subdirectory must supply rules for building sources it contributes
%.oer4f: ../%.c $(GEN_OPTS) | $(GEN_FILES) $(GEN_MISC_FILES)
	@echo 'Arm Compiler - building file: "$<"'
	"/home/vish/ti/ti-cgt-arm_16.9.6.LTS/bin/armcl" -mv7R4 --code_state=16 --float_support=VFPv3D16 -me -O3 --include_path="/home/vish/workspace_ccstheia/out_of_box_1843_mss" --include_path="/home/vish/ti/mmwave_sdk_03_06_02_00-LTS/packages" --include_path="/home/vish/ti/ti-cgt-arm_16.9.6.LTS/include" --define=SOC_XWR18XX --define=SUBSYS_MSS --define=DOWNLOAD_FROM_CCS --define=MMWAVE_L3RAM_NUM_BANK=8 --define=MMWAVE_SHMEM_TCMA_NUM_BANK=0 --define=MMWAVE_SHMEM_TCMB_NUM_BANK=0 --define=MMWAVE_SHMEM_BANK_SIZE=0x20000 --define=DebugP_ASSERT_ENABLED --define=_LITTLE_ENDIAN --define=OBJDET_NO_RANGE --define=APP_RESOURCE_FILE='<'ti/demo/xwr18xx/mmw/mmw_res.h'>' -g --diag_warning=225 --diag_wrap=off --display_error_number --gen_func_subsections=on --enum_type=int --abi=eabi --obj_extension=.oer4f --elf --preproc_with_compile --preproc_dependency="$(basename $(<F)).d_raw" $(GEN_OPTS__FLAG) "$(shell echo $<)"
	@echo 'Finished building: "$<"'
	@echo ' '

build-574361217:
	@$(MAKE) --no-print-directory -Onone -f subdir_rules.mk build-574361217-inproc

build-574361217-inproc: ../mmw_mss.cfg
	@echo 'XDCtools - building file: "$<"'
	"/home/vish/ti/xdctools_3_50_08_24_core/xs" --xdcpath="/home/vish/ti/bios_6_73_01_01/packages;" xdc.tools.configuro -o configPkg -t ti.targets.arm.elf.R4Ft -p ti.platforms.cortexR:IWR18XX:false:200 -r release -c "/home/vish/ti/ti-cgt-arm_16.9.6.LTS" --compileOptions "--enum_type=int" "$<"
	@echo 'Finished building: "$<"'
	@echo ' '

configPkg/linker.cmd: build-574361217 ../mmw_mss.cfg
configPkg/compiler.opt: build-574361217
configPkg: build-574361217


