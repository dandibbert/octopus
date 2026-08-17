package cmd

import (
	"fmt"
	"os"

	"github.com/bestruirui/octopus/internal/conf"
	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/spf13/cobra"
)

var disable2FACmd = &cobra.Command{
	Use:   "disable-2fa",
	Short: "Disable two-factor authentication and clear the TOTP secret",
	PreRun: func(cmd *cobra.Command, args []string) {
		conf.Load(cfgFile)
		log.SetLevel(conf.AppConfig.Log.Level)
	},
	Run: func(cmd *cobra.Command, args []string) {
		if err := db.InitDB(conf.AppConfig.Database.Type, conf.AppConfig.Database.Path, conf.IsDebug()); err != nil {
			fmt.Printf("database init error: %v\n", err)
			os.Exit(1)
		}
		defer db.Close()
		if err := op.InitCache(); err != nil {
			fmt.Printf("cache init error: %v\n", err)
			os.Exit(1)
		}
		if err := op.UserInit(); err != nil {
			fmt.Printf("user init error: %v\n", err)
			os.Exit(1)
		}
		if err := op.TwoFactorForceDisable(); err != nil {
			fmt.Printf("failed to disable two-factor authentication: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("two-factor authentication disabled in the database")
		fmt.Println("restart the running octopus process so it reloads the in-memory settings cache; password-only login will work after that")
	},
}

func init() {
	disable2FACmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is ./data/config.json)")
	rootCmd.AddCommand(disable2FACmd)
}
