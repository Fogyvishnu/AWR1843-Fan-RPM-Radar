################################################################################
# Automatically-generated file. Do not edit!
################################################################################

# Each subdirectory must supply rules for building sources it contributes
%.oe674: ../%.c $(GEN_OPTS) | $(GEN_FILES) $(GEN_MISC_FILES)
	@echo 'C6000 Compiler - building file: "$<"'
	"/home/vish/ti/ti-cgt-c6000_8.3.3/bin/cl6x" -mv6740 --abi=eabi -O3 --opt_for_speed=3 --include_path="/home/vish/workspace_ccstheia/out_of_box_1843_dss" --include_path="/home/vish/ti/mmwave_sdk_03_06_02_00-LTS/packages" --include_path="/home/vish/ti/ti-cgt-c6000_8.3.3/include" --define=SOC_XWR18XX --define=SUBSYS_DSS --define=MMWAVE_L3RAM_NUM_BANK=6 --define=MMWAVE_SHMEM_TCMA_NUM_BANK=0 --define=MMWAVE_SHMEM_TCMB_NUM_BANK=0 --define=MMWAVE_SHMEM_BANK_SIZE=0x20000 --define=DOWNLOAD_FROM_CCS --define=DebugP_ASSERT_ENABLED --define=_LITTLE_ENDIAN --define=OBJDET_NO_RANGE --define=APP_RESOURCE_FILE='<'ti/demo/xwr18xx/mmw/mmw_res.h'>' -g --gcc --diag_error=10015 --diag_warning=225 --diag_wrap=off --display_error_number --gen_func_subsections=on --obj_extension=.oe674 --preproc_with_compile --preproc_dependency="$(basename $(<F)).d_raw" $(GEN_OPTS__FLAG) "$(shell echo $<)"
	@echo 'Finished building: "$<"'
	@echo ' '

build-27720233:
	@$(MAKE) --no-print-directory -Onone -f subdir_rules.mk build-27720233-inproc

build-27720233-inproc: ../mmw_dss.cfg
	@echo 'XDCtools - building file: "$<"'
	"/home/vish/ti/xdctools_3_50_08_24_core/xs" --xdcpath="/home/vish/ti/bios_6_73_01_01/packages;/home/vish/ti/mathlib_c674x_3_1_2_1/packages;" xdc.tools.configuro -o configPkg -t ti.targets.elf.C674 -p ti.platforms.c6x:IWR18XX:false:600 -r release -c "/home/vish/ti/ti-cgt-c6000_8.3.3" --compileOptions "--enum_type=int" "$<"
	@echo 'Finished building: "$<"'
	@echo ' '

configPkg/linker.cmd: build-27720233 ../mmw_dss.cfg
configPkg/compiler.opt: build-27720233
configPkg: build-27720233


